import { z } from "zod";

import type { Factory } from "./configuration.ts";
import type {
	FactoryQuestion,
	FactoryRun,
	RunAgent,
	RunCheckpoint,
	RunDetail,
	RunEvent,
	RunGraph,
	RunMessage,
	RunStatusKind,
	RunUsage,
} from "./domain.ts";
import { liveRunStatusKinds } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { FactoryReader } from "./ports.ts";
import { runUsage } from "./run-usage.ts";

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
		reason: z.string().nullish(),
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
			node_path: z.string().nullish(),
			text: z.string(),
		}),
	),
});

/** The `data` of a `steer.delivered` event. */
const deliveredSteer = z.object({
	steer: z.union([z.number(), z.string()]).transform(String),
	sender: z.string(),
	text: z.string(),
	delivered_at: z.string(),
});

const checkpoint = z.object({
	current_node: z.string(),
	stack: z.array(z.object({ node: z.string() })).optional(),
	completed_nodes: z.array(z.string()).default([]),
	node_retries: z.record(z.string(), z.number()).default({}),
	visits: z.record(z.string(), z.number()).default({}),
});

/** `GET /runs/{id}/turns`: one summary for each finished agent turn of the run. */
const turns = z.object({
	turns: z.array(
		z.object({
			node_path: z.string(),
			tools: z.record(z.string(), z.number()),
			tokens: z.object({ input: z.number(), output: z.number() }),
			cost_usd: z.number(),
			duration_s: z.number(),
		}),
	),
});

/** The live counters of each worker of a run, by node path. */
const workers = z.object({
	workers: z.record(
		z.string(),
		z.object({
			current_tool: z.string(),
			last_message: z.string(),
			turn: z.enum(["running", "ended"]),
		}),
	),
});

/** The current node path: the caller node of each child graph, then the current node. */
function stagePath(answer: z.infer<typeof checkpoint>): string {
	return [
		...(answer.stack ?? []).map((frame) => frame.node),
		answer.current_node,
	]
		.filter((node) => node !== "")
		.join("/");
}

const labelled = z.object({ label: z.string().optional() }).default({});

/** The `GET /runs/{id}/graph` answer: the frozen entry graph of the run's workflow. */
const workflowGraph = z.object({
	name: z.string().optional(),
	nodes: z.array(z.object({ id: z.string(), attrs: labelled })),
	edges: z.array(
		z.object({ from: z.string(), to: z.string(), attrs: labelled }),
	),
});

/**
 * The graph of a run with the checkpoint state of each top-level node. A child
 * graph runs inside its caller node, so the caller node is the current one.
 */
function runGraph(
	graph: z.infer<typeof workflowGraph>,
	answer: z.infer<typeof checkpoint>,
): RunGraph {
	const current = stagePath(answer).split("/")[0];
	const completed = new Set(answer.completed_nodes);
	return {
		nodes: graph.nodes.map((node) => ({
			id: node.id,
			label: node.attrs.label ?? node.id,
			state:
				node.id === current
					? "current"
					: completed.has(node.id)
						? "completed"
						: "ahead",
			retries: answer.node_retries[node.id] ?? 0,
		})),
		edges: graph.edges.map((edge) => ({
			from: edge.from,
			to: edge.to,
			...(edge.attrs.label === undefined ? {} : { label: edge.attrs.label }),
		})),
	};
}

/** One frame of the hub's `GET /events`: a box event of a run, or a status change. */
const eventFrame = z.object({
	run_id: z.string(),
	item: z
		.object({ event: z.string(), node_path: z.string(), data: z.unknown() })
		.optional(),
	recorded_at: z.string().optional(),
	status: runRow.shape.status.optional(),
});

type EventFrame = z.infer<typeof eventFrame>;

const localMachine = "local";

/** A run row of one factory. A local row comes from the box that does the run. */
type ReadRun = {
	run: Omit<FactoryRun, "coveredByFeed" | "streamed" | "stage">;
	local: boolean;
	url: string;
};

function isLive(kind: RunStatusKind): boolean {
	return liveRunStatusKinds.some((live) => live === kind);
}

function statusKindOf(
	kind: z.infer<typeof runRow>["status"]["kind"],
): RunStatusKind {
	return kind === "submitted" ? "queued" : kind;
}

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
					statusKind: statusKindOf(run.status.kind),
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
					...(run.status.reason === null ||
					run.status.reason === undefined ||
					run.status.reason === ""
						? {}
						: { failureReason: run.status.reason }),
				},
				local,
				url: factory.url,
			},
		];
	});
}

/**
 * The row that gives a run its status: the box row while its box is reachable,
 * or else the hub row. An unreachable box keeps its last row, which goes stale.
 */
function statusRow<Row extends ReadRun>(
	same: Row[],
	reachable: (row: Row) => boolean,
) {
	const hubRow = same.find((row) => !row.local);
	const boxRow = same.find((row) => row.local);
	const fresh =
		boxRow !== undefined && (hubRow === undefined || reachable(boxRow));
	return { hubRow, row: fresh ? boxRow : hubRow };
}

/**
 * One run per id. A hub and its box report the same id once the hub sends the run.
 * The status row gives the status, and the hub row gives `source` and `rule`.
 */
function mergedRuns(
	rows: (ReadRun & { coveredByFeed: boolean; streamed: boolean })[],
	stages: ReadonlyMap<string, string>,
) {
	return [...Map.groupBy(rows, (row) => row.run.id).values()].flatMap(
		(same): FactoryRun[] => {
			const { hubRow, row } = statusRow(same, (row) => row.coveredByFeed);
			if (row === undefined) {
				return [];
			}
			const { source, rule, ...status } = row.run;
			const origin = hubRow?.run ?? row.run;
			const stage = stages.get(status.id);
			return [
				{
					...status,
					...(origin.source === undefined ? {} : { source: origin.source }),
					...(origin.rule === undefined ? {} : { rule: origin.rule }),
					coveredByFeed: row.coveredByFeed,
					streamed: same.some((row) => row.streamed),
					...(stage === undefined ? {} : { stage }),
				},
			];
		},
	);
}

/**
 * The current node of a run after one event. A finished node hands the run back
 * to the node of the child graph that holds it.
 */
function nodeAfter(
	current: string | undefined,
	event: string,
	nodePath: string,
): string | undefined {
	if (event === "stage.started") {
		return nodePath;
	}
	const finished = event === "stage.completed" || event === "stage.failed";
	if (
		!finished ||
		current === undefined ||
		(current !== nodePath && !current.startsWith(`${nodePath}/`))
	) {
		return current;
	}
	const parent = nodePath.split("/").slice(0, -1).join("/");
	return parent === "" ? undefined : parent;
}

function jsonOrNull(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** The frames of an SSE body. A frame that does not parse is left out. */
async function* eventFrames(body: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const bytes of body) {
		buffer += decoder.decode(bytes, { stream: true }).replaceAll("\r\n", "\n");
		const blocks = buffer.split("\n\n");
		buffer = blocks.pop() ?? "";
		for (const block of blocks) {
			const data = block
				.split("\n")
				.flatMap((line) =>
					line.startsWith("data:") ? [line.slice("data:".length).trim()] : [],
				)
				.join("\n");
			const parsed = eventFrame.safeParse(jsonOrNull(data));
			if (parsed.success) {
				yield parsed.data;
			}
		}
	}
}

class Unreachable extends Error {}

/** The factory answered a read with 404: it does not serve the route. */
class NotServed extends Unreachable {}

/** The name of a `--factory` URL: its host, or its socket path. */
export function flagFactory(url: string): Factory {
	const parsed = new URL(url);
	return {
		name: parsed.protocol === "unix:" ? parsed.pathname : parsed.host,
		url,
	};
}

/** A stream request has no time limit: it stays open while the hub sends events. */
function reader(
	fetchImpl: Fetch,
	url: string,
	signal: AbortSignal,
	limitMs: number | null = factoryRequestLimitMs,
) {
	const parsed = new URL(url);
	const unix = parsed.protocol === "unix:";
	const base = unix
		? "http://localhost"
		: `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
	return async (path: string, post?: { json: unknown }): Promise<Response> => {
		try {
			return await fetchImpl(`${base}${path}`, {
				signal:
					limitMs === null
						? signal
						: AbortSignal.any([signal, AbortSignal.timeout(limitMs)]),
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
	if (response.status === 404) {
		throw new NotServed();
	}
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
): Promise<z.infer<typeof openQuestions>["questions"] | undefined> {
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

/** The usage of a run from its recorded turns. A factory that gives no turns leaves it unknown. */
async function usageOf(
	read: (path: string) => Promise<Response>,
	id: string,
): Promise<RunUsage | "not served" | null> {
	try {
		const listed = await body(
			await read(`/runs/${encodeURIComponent(id)}/turns`),
			turns,
		);
		return runUsage(
			listed.turns.map((turn) => ({
				nodePath: turn.node_path,
				usage: {
					inputTokens: turn.tokens.input,
					outputTokens: turn.tokens.output,
					costUsd: turn.cost_usd,
					durationS: turn.duration_s,
					tools: turn.tools,
				},
			})),
		);
	} catch (error) {
		if (error instanceof NotServed) {
			return "not served";
		}
		if (!(error instanceof Unreachable)) {
			throw error;
		}
		return null;
	}
}

export type CheckpointRead = RunCheckpoint | "missing" | "not served";

export type AnswerResult = "answered" | "missing" | "failed";

export type SteerResult = "steered" | "missing" | "ended" | "failed";

export type Steer = { stage: string; text: string; interrupt: boolean };

/** Project Flow writes to a factory as Lev: the factory records this sender on each steer. */
const levSender = "lev";

/**
 * The event stream of one factory: connecting, open, closed since a time, or
 * "none" for a factory that answers 404 on `GET /events`.
 */
type Follow = "connecting" | "open" | "none" | { closedAt: number };

const streamRetryMs = 10_000;

/** The hub sends no frame for a queued run and no run times, so a streamed factory keeps this `GET /runs` read. */
const streamedRunPollMs = 60_000;

const activeKinds: ReadonlySet<RunStatusKind> = new Set([
	"starting",
	"running",
	"blocked",
]);

/**
 * Reads `GET /daemon` of each factory, and on connect its kind and box count.
 * Reads `GET /runs` of each factory and keeps the runs of its last good read.
 * Follows `GET /events` of each factory that serves it, and reads `GET /runs`
 * on each connect and at a slower interval while the stream is open.
 * A factory without `/events` keeps the run poll.
 * A failed request marks the factory unreachable until a later read succeeds.
 */
export function factoryReader(
	fetchImpl: Fetch,
	listed: () => ListedFactory[],
	signal: AbortSignal,
	now: () => Date,
): FactoryReader {
	const found = new Map<string, Found>();
	const readRuns = new Map<string, ReadRun[]>();
	/**
	 * The thread of each run, by run id. The factory keeps no answered asks and the
	 * hub replays no older events, so the thread holds what this launch saw.
	 */
	const threads = new Map<string, RunMessage[]>();
	/** The asks and steers already in a thread, by run id and factory id. */
	const threaded = new Set<string>();
	const addMessage = (
		runId: string,
		message: RunMessage,
		once?: string,
	): void => {
		if (once !== undefined) {
			const key = JSON.stringify([runId, once]);
			if (threaded.has(key)) {
				return;
			}
			threaded.add(key);
		}
		threads.set(runId, [...(threads.get(runId) ?? []), message]);
	};
	/** The open questions of a blocked run. Each question that is new to the thread joins it as an ask. */
	const openQuestionsOf = async (
		read: (path: string) => Promise<Response>,
		runId: string,
	): Promise<FactoryQuestion[] | undefined> => {
		const questions = await questionsOf(read, runId);
		return questions?.map((question) => {
			addMessage(
				runId,
				{
					kind: "ask",
					sender: question.node_path ?? "run",
					text: question.text,
					at: now().toISOString(),
				},
				`question ${question.id}`,
			);
			return { id: question.id, text: question.text };
		});
	};
	/** The current node of each run, by run id, from the event streams. */
	const stages = new Map<string, string>();
	/** The last box event of each run, by run id, from the event streams. */
	const lastEvents = new Map<string, RunEvent>();
	const follows = new Map<string, Follow>();
	/** The clock time of the last `GET /runs` read of each streamed factory. */
	const streamReadAt = new Map<string, number>();
	/** The factories whose `GET /events` answered once. */
	const serving = new Set<string>();
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
	const reachable = (row: ReadRun) => found.get(row.url)?.reachable === true;
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
					const questions = await openQuestionsOf(read, row.run.id);
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
	const readAllRuns = async (now: number): Promise<void> => {
		await Promise.all(
			listed()
				.filter((factory) => {
					if (follows.get(factory.url) !== "open") {
						return true;
					}
					const readAt = streamReadAt.get(factory.url);
					if (readAt !== undefined && now - readAt < streamedRunPollMs) {
						return false;
					}
					streamReadAt.set(factory.url, now);
					return true;
				})
				.map(readRunsOf),
		);
	};
	const readCurrentNode = async (
		read: (path: string) => Promise<Response>,
		runId: string,
	): Promise<void> => {
		try {
			const answer = await body(
				await read(`/runs/${encodeURIComponent(runId)}/checkpoint`),
				checkpoint,
			);
			const path = stagePath(answer);
			if (path === "") {
				stages.delete(runId);
			} else {
				stages.set(runId, path);
			}
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
		}
	};
	/** `GET /runs`, then the current node of each active run from its checkpoint. */
	const snapshot = async (factory: ListedFactory): Promise<void> => {
		await readRunsOf(factory);
		const read = reader(fetchImpl, factory.url, signal);
		await Promise.all(
			(readRuns.get(factory.url) ?? []).flatMap(({ run }) =>
				activeKinds.has(run.statusKind) ? [readCurrentNode(read, run.id)] : [],
			),
		);
	};
	const applyFrame = async (
		factory: ListedFactory,
		frame: EventFrame,
	): Promise<void> => {
		const rows = readRuns.get(factory.url) ?? [];
		if (!rows.some((row) => row.run.id === frame.run_id)) {
			await readRunsOf(factory);
		}
		if (frame.item?.event === "steer.delivered") {
			const steer = deliveredSteer.safeParse(frame.item.data);
			if (steer.success) {
				addMessage(
					frame.run_id,
					{
						kind: "steer",
						sender: steer.data.sender,
						text: steer.data.text,
						at: steer.data.delivered_at,
					},
					`steer ${steer.data.steer}`,
				);
			}
		}
		if (frame.item !== undefined) {
			lastEvents.set(frame.run_id, {
				event: frame.item.event,
				stage: frame.item.node_path,
				...(frame.recorded_at === undefined ? {} : { at: frame.recorded_at }),
			});
			const node = nodeAfter(
				stages.get(frame.run_id),
				frame.item.event,
				frame.item.node_path,
			);
			if (node === undefined) {
				stages.delete(frame.run_id);
			} else {
				stages.set(frame.run_id, node);
			}
		}
		const status = frame.status;
		if (status !== undefined) {
			const statusKind = statusKindOf(status.kind);
			const questions =
				statusKind === "blocked"
					? await openQuestionsOf(
							reader(fetchImpl, factory.url, signal),
							frame.run_id,
						)
					: undefined;
			readRuns.set(
				factory.url,
				(readRuns.get(factory.url) ?? []).map((row) => {
					if (row.run.id !== frame.run_id) {
						return row;
					}
					const { questions: _left, ...run } = row.run;
					return {
						...row,
						run: {
							...run,
							statusKind,
							...(questions === undefined ? {} : { questions }),
						},
					};
				}),
			);
		}
	};
	const followOne = async (
		factory: ListedFactory,
		now: () => number,
		around: (change: () => Promise<void>) => Promise<void>,
	): Promise<Follow> => {
		let response: Response;
		try {
			response = await reader(fetchImpl, factory.url, signal, null)("/events");
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return { closedAt: now() };
		}
		if (response.status === 404) {
			return "none";
		}
		if (!response.ok || response.body === null) {
			return { closedAt: now() };
		}
		follows.set(factory.url, "open");
		serving.add(factory.url);
		streamReadAt.set(factory.url, now());
		// The hub replays only the events since connect, so the snapshot follows the connect.
		await around(() => snapshot(factory));
		try {
			for await (const frame of eventFrames(response.body)) {
				await around(() => applyFrame(factory, frame));
			}
		} catch {
			// A dropped connection ends the stream like a closed one.
		}
		return { closedAt: now() };
	};
	const follow = (
		now: () => number,
		around: (change: () => Promise<void>) => Promise<void>,
	): void => {
		for (const factory of listed()) {
			const state = follows.get(factory.url);
			if (
				state === "connecting" ||
				state === "open" ||
				state === "none" ||
				(state !== undefined && now() - state.closedAt < streamRetryMs)
			) {
				continue;
			}
			follows.set(factory.url, "connecting");
			void followOne(factory, now, around)
				.catch((): Follow => ({ closedAt: now() }))
				.then((next) => {
					follows.set(factory.url, next);
				});
		}
	};
	const runs = (): FactoryRun[] =>
		mergedRuns(
			listed().flatMap((factory) => {
				const coveredByFeed = found.get(factory.url)?.reachable === true;
				const streamed = serving.has(factory.url);
				return (readRuns.get(factory.url) ?? []).map((row) => ({
					...row,
					coveredByFeed,
					streamed,
				}));
			}),
			stages,
		)
			.map((run) => {
				const thread = threads.get(run.id);
				return thread === undefined
					? run
					: {
							...run,
							thread: thread.toSorted(
								(left, right) => Date.parse(left.at) - Date.parse(right.at),
							),
						};
			})
			.sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
	/** A run's workflow graph does not change while it runs, so the first good read stays. */
	const graphs = new Map<string, z.infer<typeof workflowGraph>>();
	const graphOf = async (
		read: (path: string) => Promise<Response>,
		runId: string,
	): Promise<z.infer<typeof workflowGraph> | null> => {
		const known = graphs.get(runId);
		if (known !== undefined) {
			return known;
		}
		try {
			const graph = await body(
				await read(`/runs/${encodeURIComponent(runId)}/graph`),
				workflowGraph,
			);
			graphs.set(runId, graph);
			return graph;
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return null;
		}
	};
	const statusRowOf = (runId: string) =>
		statusRow(
			listed().flatMap((factory) =>
				(readRuns.get(factory.url) ?? []).filter((row) => row.run.id === runId),
			),
			reachable,
		);
	const runCheckpoint = async (runId: string): Promise<CheckpointRead> => {
		const { row } = statusRowOf(runId);
		if (row === undefined) {
			return "missing";
		}
		const read = reader(fetchImpl, row.url, signal);
		const usage = usageOf(read, runId);
		try {
			const [answer, graph] = await Promise.all([
				read(`/runs/${encodeURIComponent(runId)}/checkpoint`).then((response) =>
					body(response, checkpoint),
				),
				graphOf(read, runId),
			]);
			const stage = stagePath(answer);
			const used = await usage;
			return {
				stage: stage === "" ? null : stage,
				completedStages: answer.completed_nodes,
				retries: answer.node_retries,
				visits: answer.visits,
				...(used === null
					? {}
					: used === "not served"
						? { usageNotServed: true }
						: { usage: used }),
				graph: graph === null ? null : runGraph(graph, answer),
			};
		} catch (error) {
			if (error instanceof NotServed) {
				return "not served";
			}
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "missing";
		}
	};
	const runDetail = async (runId: string): Promise<RunDetail | null> => {
		const run = runs().find((run) => run.id === runId);
		const { row } = statusRowOf(runId);
		if (run === undefined || row === undefined) {
			return null;
		}
		const graph = await graphOf(reader(fetchImpl, row.url, signal), runId);
		const lastEvent = lastEvents.get(runId);
		return {
			...run,
			...(graph?.name === undefined ? {} : { workflow: graph.name }),
			...(lastEvent === undefined ? {} : { lastEvent }),
		};
	};
	const runAgents = async (runId: string): Promise<RunAgent[] | null> => {
		const { row } = statusRowOf(runId);
		if (row === undefined) {
			return null;
		}
		if (!isLive(row.run.statusKind)) {
			return [];
		}
		const read = reader(fetchImpl, row.url, signal);
		try {
			const answer = await body(
				await read(`/runs/${encodeURIComponent(runId)}/workers`),
				workers,
			);
			const stage = stages.get(runId);
			return Object.entries(answer.workers)
				.filter(([path, worker]) => worker.turn === "running" || path === stage)
				.map(([path, worker]) => ({
					stage: path,
					tool: worker.current_tool === "" ? null : worker.current_tool,
					lastMessage: worker.last_message === "" ? null : worker.last_message,
					turn: worker.turn,
				}));
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return [];
		}
	};
	const answer = async (
		run: string,
		question: string,
		text: string,
	): Promise<AnswerResult> => {
		const same = listed().flatMap((factory) =>
			(readRuns.get(factory.url) ?? []).filter((row) => row.run.id === run),
		);
		const { hubRow, row } = statusRow(same, reachable);
		// Only the hub posts an answer to the ticket thread, so a hub-covered run answers there.
		const target = hubRow ?? row;
		if (
			target === undefined ||
			row?.run.questions?.some((item) => item.id === question) !== true
		) {
			return "missing";
		}
		const read = reader(fetchImpl, target.url, signal);
		try {
			const response = await read(
				`/runs/${encodeURIComponent(run)}/questions/${encodeURIComponent(question)}/answer`,
				{ json: { text } },
			);
			if (response.ok) {
				addMessage(run, {
					kind: "answer",
					sender: levSender,
					text,
					at: now().toISOString(),
				});
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
	const steer = async (run: string, steer: Steer): Promise<SteerResult> => {
		const { hubRow, row } = statusRow(
			listed().flatMap((factory) =>
				(readRuns.get(factory.url) ?? []).filter((row) => row.run.id === run),
			),
			reachable,
		);
		// The hub forwards a steer to the box that does the run.
		const target = hubRow ?? row;
		if (target === undefined) {
			return "missing";
		}
		const read = reader(fetchImpl, target.url, signal);
		try {
			const response = await read(`/runs/${encodeURIComponent(run)}/steer`, {
				json: { ...steer, sender: levSender },
			});
			if (response.ok) {
				return "steered";
			}
			if (response.status === 409) {
				return "ended";
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
		follow,
		runs,
		run: runDetail,
		checkpoint: runCheckpoint,
		agents: runAgents,
		answer,
		steer,
	};
}
