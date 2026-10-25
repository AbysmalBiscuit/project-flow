import { z } from "zod";

import type { Factory } from "./configuration.ts";
import type { FactoryQuestion, FactoryRun } from "./domain.ts";
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
	/** The hub that also reports the runs of this box. */
	alsoReadThroughHub?: string;
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
	source: z.string().nullish(),
	rule: z.string().nullish(),
	submitted_at: z.string(),
	started_at: z.string().nullish(),
	ended_at: z.string().nullish(),
});

const runRows = z.object({ runs: z.array(z.unknown()) });

const openQuestions = z.object({
	questions: z.array(
		z.object({
			id: z.union([z.number(), z.string()]).transform(String),
			text: z.string(),
		}),
	),
});

const localMachine = "local";

/** A run row of one factory. A local row comes from the box that does the run. */
type ReadRun = {
	run: Omit<FactoryRun, "coveredByFeed">;
	local: boolean;
	url: string;
};

/** The runs of one `GET /runs` answer. A row that does not parse is left out. */
function factoryRuns(rows: unknown[], factory: Factory): ReadRun[] {
	return rows.flatMap((row) => {
		const parsed = runRow.safeParse(row);
		if (!parsed.success) {
			return [];
		}
		const run = parsed.data;
		const machine = run.machine ?? null;
		const local = machine === localMachine;
		return [
			{
				run: {
					id: run.id,
					key: run.ticket,
					...(run.repo === null || run.repo === undefined
						? {}
						: { repo: run.repo }),
					statusKind:
						run.status.kind === "submitted" ? "queued" : run.status.kind,
					box: local ? factory.name : machine,
					factory: factory.name,
					...(run.source === null || run.source === undefined
						? {}
						: { source: run.source }),
					...(run.rule === null || run.rule === undefined
						? {}
						: { rule: run.rule }),
					submittedAt: run.submitted_at,
					startedAt: run.started_at ?? null,
					endedAt: run.ended_at ?? null,
				},
				local,
				url: factory.url,
			},
		];
	});
}

/** The row that gives a run its status: the box row, or else the hub row. */
function statusRow<Row extends ReadRun>(same: Row[]) {
	const hubRow = same.find((row) => !row.local);
	return { hubRow, boxRow: same.find((row) => row.local) ?? hubRow };
}

/**
 * One run per id. A hub and its box report the same id once the hub sends the run.
 * The box row gives the status, and the hub row gives `source` and `rule`.
 */
function mergedRuns(rows: (ReadRun & { coveredByFeed: boolean })[]) {
	return [...Map.groupBy(rows, (row) => row.run.id).values()].flatMap(
		(same): FactoryRun[] => {
			const { hubRow, boxRow } = statusRow(same);
			if (boxRow === undefined) {
				return [];
			}
			const { source, rule, ...status } = boxRow.run;
			const origin = hubRow?.run ?? boxRow.run;
			return [
				{
					...status,
					...(origin.source === undefined ? {} : { source: origin.source }),
					...(origin.rule === undefined ? {} : { rule: origin.rule }),
					coveredByFeed: boxRow.coveredByFeed,
				},
			];
		},
	);
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
	return async (path: string, post?: { json: unknown }): Promise<Response> => {
		try {
			return await fetchImpl(`${base}${path}`, {
				signal: AbortSignal.any([
					signal,
					AbortSignal.timeout(factoryRequestLimitMs),
				]),
				...(unix ? { unix: parsed.pathname } : {}),
				...(post === undefined
					? {}
					: {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(post.json),
						}),
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

/** The open questions of a blocked run. A factory that gives no list leaves them unknown. */
async function questionsOf(
	read: (path: string) => Promise<Response>,
	id: string,
): Promise<FactoryQuestion[] | undefined> {
	try {
		const listed = await body(
			await read(`/runs/${encodeURIComponent(id)}/questions`),
			openQuestions,
		);
		return listed.questions;
	} catch (error) {
		if (!(error instanceof Unreachable)) {
			throw error;
		}
		return undefined;
	}
}

export type AnswerResult = "answered" | "missing" | "failed";

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
	const hubAlsoReading = (factory: ListedFactory): string | undefined => {
		const localIds = new Set(
			(readRuns.get(factory.url) ?? []).flatMap((row) =>
				row.local ? [row.run.id] : [],
			),
		);
		return listed().find(
			(other) =>
				other.url !== factory.url &&
				(readRuns.get(other.url) ?? []).some(
					(row) => !row.local && localIds.has(row.run.id),
				),
		)?.name;
	};
	const entries = (): FactoryEntry[] =>
		listed().map((factory) => {
			const hubName = hubAlsoReading(factory);
			return {
				...factory,
				...(found.get(factory.url) ?? {
					reachable: false,
					kind: null,
					boxes: null,
				}),
				...(hubName === undefined ? {} : { alsoReadThroughHub: hubName }),
			};
		});
	const unreachable = () =>
		listed().some((factory) => found.get(factory.url)?.reachable === false);
	const readRunsOf = async (factory: ListedFactory): Promise<void> => {
		const read = reader(fetchImpl, factory.url, signal);
		const known = found.get(factory.url);
		try {
			const answer = await body(await read("/runs"), runRows);
			const rows = await Promise.all(
				factoryRuns(answer.runs, factory).map(async (row) => {
					if (row.run.statusKind !== "blocked") {
						return row;
					}
					const questions = await questionsOf(read, row.run.id);
					return questions === undefined
						? row
						: { ...row, run: { ...row.run, questions } };
				}),
			);
			readRuns.set(factory.url, rows);
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
		mergedRuns(
			listed().flatMap((factory) => {
				const coveredByFeed = found.get(factory.url)?.reachable === true;
				return (readRuns.get(factory.url) ?? []).map((row) => ({
					...row,
					coveredByFeed,
				}));
			}),
		).sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
	const answer = async (
		run: string,
		question: string,
		text: string,
	): Promise<AnswerResult> => {
		const same = listed().flatMap((factory) =>
			(readRuns.get(factory.url) ?? []).filter((row) => row.run.id === run),
		);
		const { boxRow } = statusRow(same);
		if (boxRow?.run.questions?.some((item) => item.id === question) !== true) {
			return "missing";
		}
		const read = reader(fetchImpl, boxRow.url, signal);
		try {
			const response = await read(
				`/runs/${encodeURIComponent(run)}/questions/${encodeURIComponent(question)}/answer`,
				{ json: { text } },
			);
			if (response.ok) {
				return "answered";
			}
			return response.status === 404 ? "missing" : "failed";
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "failed";
		}
	};
	return {
		check,
		settled,
		entries,
		unreachable,
		readRuns: readAllRuns,
		runs,
		answer,
	};
}
