import { z } from "zod";

import type { Factory } from "./configuration.ts";
import type { FactoryRun } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { FactoryReader } from "./ports.ts";

export type FactoryKind = "hub" | "daemon";

/** A factory that this launch reads, and what its last check found. */
export type FactoryEntry = Factory & {
	source: "flag" | "config";
	reachable: boolean;
	kind: FactoryKind | null;
	/** The boxes that the hub's runs name. Null for a daemon. */
	boxes: number | null;
};

export type ListedFactory = Factory & { source: FactoryEntry["source"] };

const factoryRequestLimitMs = 5_000;

const about = z.object({ role: z.enum(["hub", "daemon"]).optional() });

const sources = z.object({ sources: z.array(z.unknown()) });

const runs = z.object({
	runs: z.array(z.object({ machine: z.string().nullish() })),
});

const runRow = z.object({
	id: z.string(),
	ticket: z.string(),
	repo: z.string().nullish(),
	status: z.object({
		kind: z.enum([
			"submitted",
			"starting",
			"running",
			"blocked",
			"succeeded",
			"failed",
		]),
	}),
	machine: z.string().nullish(),
	submitted_at: z.string(),
	started_at: z.string().nullish(),
	ended_at: z.string().nullish(),
});

const runRows = z.object({ runs: z.array(z.unknown()) });

const localMachine = "local";

type ReadRun = Omit<FactoryRun, "coveredByFeed">;

/** The runs of one `GET /runs` answer. A row that does not parse is left out. */
function factoryRuns(rows: unknown[], factory: Factory): ReadRun[] {
	return rows.flatMap((row) => {
		const parsed = runRow.safeParse(row);
		if (!parsed.success) {
			return [];
		}
		const run = parsed.data;
		const machine = run.machine ?? null;
		return [
			{
				id: run.id,
				key: run.ticket,
				...(run.repo === null || run.repo === undefined
					? {}
					: { repo: run.repo }),
				statusKind:
					run.status.kind === "submitted" ? "queued" : run.status.kind,
				box: machine === localMachine ? factory.name : machine,
				factory: factory.name,
				submittedAt: run.submitted_at,
				startedAt: run.started_at ?? null,
				endedAt: run.ended_at ?? null,
			},
		];
	});
}

class Unreachable extends Error {}

/** The name of a `--factory` URL: its host, or its socket path. */
export function flagFactory(url: string): Factory {
	const parsed = new URL(url);
	return {
		name: parsed.protocol === "unix:" ? parsed.pathname : parsed.host,
		url,
	};
}

function reader(fetchImpl: Fetch, url: string, signal: AbortSignal) {
	const parsed = new URL(url);
	const unix = parsed.protocol === "unix:";
	const base = unix
		? "http://localhost"
		: `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
	return async (path: string): Promise<Response> => {
		try {
			return await fetchImpl(`${base}${path}`, {
				signal: AbortSignal.any([
					signal,
					AbortSignal.timeout(factoryRequestLimitMs),
				]),
				...(unix ? { unix: parsed.pathname } : {}),
			});
		} catch {
			throw new Unreachable();
		}
	};
}

async function body<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
	if (!response.ok) {
		throw new Unreachable();
	}
	const parsed = schema.safeParse(await response.json().catch(() => null));
	if (!parsed.success) {
		throw new Unreachable();
	}
	return parsed.data;
}

async function factoryKind(
	read: (path: string) => Promise<Response>,
	role: FactoryKind | undefined,
): Promise<FactoryKind> {
	if (role !== undefined) {
		return role;
	}
	const response = await read("/sources");
	if (response.status === 404) {
		return "daemon";
	}
	// A daemon without hub sources answers `/sources` with an empty list.
	const listed = await body(response, sources);
	return listed.sources.length > 0 ? "hub" : "daemon";
}

async function boxCount(
	read: (path: string) => Promise<Response>,
): Promise<number> {
	const listed = await body(await read("/runs"), runs);
	const machines = listed.runs.flatMap(({ machine }) =>
		machine === null || machine === undefined || machine === localMachine
			? []
			: [machine],
	);
	return new Set(machines).size;
}

type Found = Pick<FactoryEntry, "reachable" | "kind" | "boxes">;

/**
 * Reads `GET /daemon` of each factory, and on connect its kind and box count.
 * Reads `GET /runs` of each factory and keeps the runs of its last good read.
 * A failed request marks the factory unreachable until a later read succeeds.
 */
export function factoryReader(
	fetchImpl: Fetch,
	listed: () => ListedFactory[],
	signal: AbortSignal,
): FactoryReader {
	const found = new Map<string, Found>();
	const readRuns = new Map<string, ReadRun[]>();
	let checking: Promise<void> | null = null;
	const checkOne = async (factory: ListedFactory): Promise<Found> => {
		const read = reader(fetchImpl, factory.url, signal);
		const known = found.get(factory.url);
		try {
			const { role } = await body(await read("/daemon"), about);
			if (known?.reachable === true && known.kind !== null) {
				return known;
			}
			const kind = await factoryKind(read, role);
			return {
				reachable: true,
				kind,
				boxes: kind === "hub" ? await boxCount(read) : null,
			};
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return {
				reachable: false,
				kind: known?.kind ?? null,
				boxes: known?.boxes ?? null,
			};
		}
	};
	const check = (): Promise<void> => {
		checking ??= (async () => {
			const factories = listed();
			const results = await Promise.all(factories.map(checkOne));
			factories.forEach((factory, index) => {
				const result = results[index];
				if (result !== undefined) {
					found.set(factory.url, result);
				}
			});
		})().finally(() => {
			checking = null;
		});
		return checking;
	};
	const settled = async (): Promise<void> => {
		await checking;
		if (listed().some((factory) => !found.has(factory.url))) {
			await check();
		}
	};
	const entries = (): FactoryEntry[] =>
		listed().map((factory) => ({
			...factory,
			...(found.get(factory.url) ?? {
				reachable: false,
				kind: null,
				boxes: null,
			}),
		}));
	const unreachable = () =>
		listed().some((factory) => found.get(factory.url)?.reachable === false);
	const readRunsOf = async (factory: ListedFactory): Promise<void> => {
		const read = reader(fetchImpl, factory.url, signal);
		const known = found.get(factory.url);
		try {
			const answer = await body(await read("/runs"), runRows);
			readRuns.set(factory.url, factoryRuns(answer.runs, factory));
			found.set(factory.url, {
				kind: known?.kind ?? null,
				boxes: known?.boxes ?? null,
				reachable: true,
			});
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			found.set(factory.url, {
				reachable: false,
				kind: known?.kind ?? null,
				boxes: known?.boxes ?? null,
			});
		}
	};
	const readAllRuns = async (): Promise<void> => {
		await Promise.all(listed().map(readRunsOf));
	};
	const runs = (): FactoryRun[] =>
		listed()
			.flatMap((factory) => {
				const coveredByFeed = found.get(factory.url)?.reachable === true;
				return (readRuns.get(factory.url) ?? []).map((run) => ({
					...run,
					coveredByFeed,
				}));
			})
			.sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
	return {
		check,
		settled,
		entries,
		unreachable,
		readRuns: readAllRuns,
		runs,
	};
}
