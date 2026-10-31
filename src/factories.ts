import { commentHtml } from "./comment-html.ts";
import type { Factory } from "./configuration.ts";
import { factoryUrl } from "./configuration.ts";
import type {
	FactoryQuestion,
	FactoryRun,
	LinearSource,
	RunEvent,
	RunMessage,
	RunStatusKind,
} from "./domain.ts";
import {
	deliveredSteer,
	type EventFrame,
	eventFrames,
	type Follow,
	nodeAfter,
	streamedRunPollMs,
	streamRetryMs,
} from "./factory-events.ts";
import { body, type Read, reader, Unreachable } from "./factory-http.ts";
import {
	about,
	boxCount,
	type FactoryKind,
	factoryKind,
	type Slots,
} from "./factory-kind.ts";
import { claimStart, runActions } from "./factory-run-actions.ts";
import { runArtifactsReader } from "./factory-run-artifacts.ts";
import {
	checkpoint,
	runDetailReader,
	stagePath,
} from "./factory-run-detail.ts";
import { runEventsReader } from "./factory-run-events.ts";
import { runFilesReader } from "./factory-run-files.ts";
import { runPullReader } from "./factory-run-pulls.ts";
import {
	asksOf,
	factoryRuns,
	mergedRuns,
	type ReadRun,
	type RunAsks,
	runRows,
	statusKindOf,
	statusRow,
} from "./factory-run-rows.ts";
import { runSandboxReader } from "./factory-run-sandbox.ts";
import { runSettingsReader } from "./factory-run-settings.ts";
import { runSourceReader } from "./factory-run-source.ts";
import { runTranscriptReader } from "./factory-run-transcript.ts";
import { linearSourcesOf } from "./factory-sources.ts";
import type { Fetch } from "./fetch.ts";
import type { FactoryReader } from "./ports.ts";

/** A factory that this launch reads, and what its last check found. */
export type FactoryEntry = Factory & {
	source: "flag" | "config";
	/** Null until the first check of the factory ends. */
	reachable: boolean | null;
	kind: FactoryKind | null;
	/** The boxes that the hub's runs name. Null for a daemon. */
	boxes: number | null;
	/** The run slots from the last `GET /daemon` read. Absent when the factory reports none. */
	slots?: Slots;
	/** The hub that also reports the runs of this box. */
	alsoReadThroughHub?: string;
};

export type ListedFactory = Factory & { source: FactoryEntry["source"] };

/** The sender of an answer that names no sender, such as an answer file on the box. */
const unnamedSender = "someone";

/**
 * A `--factory` value: `NAME=URL`, or a bare URL that takes its host or socket path as its name.
 * A URL always has a `:` before its first `=`, so a name cannot hold a `:`.
 */
export function flagFactory(value: string): Factory | { error: string } {
	const labelled = /^([^:=]*)=(.*)$/s.exec(value);
	const name = labelled?.[1]?.trim();
	const url = (labelled?.[2] ?? value).trim();
	if (name === "") {
		return { error: "invalid factory: --factory needs a name before =" };
	}
	if (!factoryUrl.safeParse(url).success) {
		return {
			error: "invalid factory: --factory needs an http, https or unix URL",
		};
	}
	const parsed = new URL(url);
	return {
		name: name ?? (parsed.protocol === "unix:" ? parsed.pathname : parsed.host),
		url,
	};
}

type Found = Pick<FactoryEntry, "reachable" | "kind" | "boxes" | "slots">;

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
	const { readPullsOf, pullOf } = runPullReader(fetchImpl, signal);
	/**
	 * The thread of each run, by run id. The factory gives the open and answered asks,
	 * but the hub replays no older events, so the steers are what this launch saw.
	 */
	const threads = new Map<string, RunMessage[]>();
	/** The asks and steers already in a thread, by run id and factory id. */
	const threaded = new Set<string>();
	const addMessage = (
		runId: string,
		message: Omit<RunMessage, "html">,
		once?: string,
	): void => {
		if (once !== undefined) {
			const key = JSON.stringify([runId, once]);
			if (threaded.has(key)) {
				return;
			}
			threaded.add(key);
		}
		threads.set(runId, [
			...(threads.get(runId) ?? []),
			{ ...message, html: commentHtml(message.text) },
		]);
	};
	/** Each ask and answer that is new to the thread of a run joins it. */
	const threadAsks = (runId: string, asks: RunAsks): void => {
		for (const ask of asks.answered) {
			// The factory gives no ask time for an answered ask, so the ask takes the answer time.
			addMessage(
				runId,
				{
					kind: "ask",
					sender: ask.node_path ?? "run",
					text: ask.text,
					question: ask.id,
					at: ask.answered_at,
				},
				`question ${ask.id}`,
			);
			addMessage(
				runId,
				{
					kind: "answer",
					sender: ask.sender ?? unnamedSender,
					text: ask.answer,
					at: ask.answered_at,
				},
				`answer ${ask.id}`,
			);
		}
		for (const question of asks.questions) {
			addMessage(
				runId,
				{
					kind: "ask",
					sender: question.node_path ?? "run",
					text: question.text,
					question: question.id,
					at: now().toISOString(),
				},
				`question ${question.id}`,
			);
		}
	};
	/** The run status at the last asks read of each run, by factory URL and run id. */
	const askedStatus = new Map<string, RunStatusKind>();
	const askedKey = (url: string, runId: string) => JSON.stringify([url, runId]);
	/** The open questions of a blocked run. Its asks and answers join the thread. */
	const openQuestionsOf = async (
		url: string,
		runId: string,
	): Promise<FactoryQuestion[] | undefined> => {
		askedStatus.set(askedKey(url, runId), "blocked");
		const asks = await asksOf(reader(fetchImpl, url, signal), runId);
		if (asks === undefined) {
			return undefined;
		}
		threadAsks(runId, asks);
		return asks.questions.map(({ id, text }) => ({ id, text }));
	};
	/** The factories whose asks reads run now. */
	const readingAsks = new Set<string>();
	/**
	 * Reads the asks of each started run once per run status, so the thread of a run
	 * holds its answered asks after a restart. The reads go one at a time and apart from
	 * the `GET /runs` read. A blocked run reads its asks within the `GET /runs` read.
	 */
	const readAsksOf = (url: string, rows: ReadRun[]): void => {
		const wanted = rows.filter(
			({ run }) =>
				run.statusKind !== "queued" &&
				run.statusKind !== "blocked" &&
				askedStatus.get(askedKey(url, run.id)) !== run.statusKind,
		);
		if (wanted.length === 0 || readingAsks.has(url)) {
			return;
		}
		readingAsks.add(url);
		const read = reader(fetchImpl, url, signal);
		void (async () => {
			for (const { run } of wanted) {
				askedStatus.set(askedKey(url, run.id), run.statusKind);
				const asks = await asksOf(read, run.id);
				if (asks !== undefined) {
					threadAsks(run.id, asks);
				}
			}
		})().finally(() => {
			readingAsks.delete(url);
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
	/** The Linear sources of each hub, by factory url, from its last good `GET /sources`. */
	const linearSources = new Map<string, LinearSource[]>();
	const readLinearSources = async (
		factory: ListedFactory,
		read: Read,
	): Promise<void> => {
		try {
			linearSources.set(factory.url, await linearSourcesOf(read, factory.name));
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
		}
	};
	const checkOne = async (factory: ListedFactory): Promise<Found> => {
		const read = reader(fetchImpl, factory.url, signal);
		const known = found.get(factory.url);
		try {
			const { role, slots } = await body(await read("/daemon"), about);
			const reported = slots === undefined ? {} : { slots };
			const kind =
				known?.reachable === true && known.kind !== null
					? known.kind
					: await factoryKind(read, role);
			if (kind === "hub") {
				await readLinearSources(factory, read);
			}
			if (known?.reachable === true && known.kind !== null) {
				return {
					reachable: true,
					kind: known.kind,
					boxes: known.boxes,
					...reported,
				};
			}
			return {
				reachable: true,
				kind,
				boxes: kind === "hub" ? await boxCount(read) : null,
				...reported,
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
					reachable: null,
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
			const answer = await body(await read("/runs?archived=1"), runRows);
			const rows = await Promise.all(
				factoryRuns(answer.runs, factory).map(async (row) => {
					if (row.run.statusKind !== "blocked") {
						return row;
					}
					const questions = await openQuestionsOf(factory.url, row.run.id);
					return questions === undefined
						? row
						: { ...row, run: { ...row.run, questions } };
				}),
			);
			readRuns.set(factory.url, rows);
			readPullsOf(factory.url, rows);
			readAsksOf(factory.url, rows);
			found.set(factory.url, {
				...known,
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
	const readCurrentNode = async (read: Read, runId: string): Promise<void> => {
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
					? await openQuestionsOf(factory.url, frame.run_id)
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
	const runList = (): FactoryRun[] =>
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
				const pull = pullOf(run.id);
				return {
					...run,
					...(pull === undefined ? {} : { pull }),
					...(thread === undefined
						? {}
						: {
								thread: thread.toSorted(
									(left, right) => Date.parse(left.at) - Date.parse(right.at),
								),
							}),
				};
			})
			.sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
	const statusRowOf = (runId: string) =>
		statusRow(
			listed().flatMap((factory) =>
				(readRuns.get(factory.url) ?? []).filter((row) => row.run.id === runId),
			),
			reachable,
		);
	const sandbox = runSandboxReader({ fetchImpl, signal, statusRowOf });
	return {
		check,
		settled,
		entries,
		linearSources: () =>
			listed().flatMap((factory) => linearSources.get(factory.url) ?? []),
		unreachable,
		readRuns: readAllRuns,
		follow,
		runs: runList,
		...runDetailReader({
			fetchImpl,
			signal,
			statusRowOf,
			runs: runList,
			stages,
			lastEvents,
		}),
		events: runEventsReader({ fetchImpl, signal, statusRowOf }),
		...runArtifactsReader({ fetchImpl, signal, statusRowOf }),
		sandbox,
		files: runFilesReader({ fetchImpl, signal, statusRowOf, sandbox }),
		...runSourceReader({ fetchImpl, signal, statusRowOf }),
		...runTranscriptReader({ fetchImpl, signal, statusRowOf }),
		settings: runSettingsReader({ fetchImpl, signal, statusRowOf }),
		...runActions({ fetchImpl, signal, now, statusRowOf, addMessage }),
		claimStart: (url, start) => claimStart(fetchImpl, signal, url, start),
	};
}
