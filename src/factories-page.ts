import type { FactoryRun } from "./domain.ts";
import type { FactoryEntry, FactoryFloor } from "./factories.ts";
import { type BoxState, hostRoute } from "./factory-host.ts";
import type { FactoryKind, Slots } from "./factory-kind.ts";
import { localMachine } from "./factory-run-rows.ts";
import { type HostHealth, hostHealth } from "./host-health.ts";
import type {
	HostSample,
	RunHistoryEnd,
	StageCost,
	StageSample,
} from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";
import { percentile } from "./stats.ts";
import { numberedKey } from "./ticket-key.ts";

const dayMs = 24 * 60 * 60 * 1_000;

/** The day ranges a reader can pick for the outcome chart and the stage durations. */
export const rangeDays = [7, 14, 30, 90] as const;

export type RangeDays = (typeof rangeDays)[number];

/** The days of the outcome chart, today included, when the reader picks none. */
export const outcomeDays: RangeDays = 14;

/** The days of run history that the stall rule covers, and the stage durations when the reader picks none. */
export const stageDays: RangeDays = 30;

/** The fewest ended runs of a stage, in the last `stageDays` days, that give the stage its stall rule. */
export const stallRuns = 10;

/** The shortest time in a stage that can stall a run, so a stage with a tiny p95 does not flag each wait. */
export const stallFloorMs = 10 * 60 * 1_000;

/** How often an open Factories tab checks each factory again, which also reads each hub queue. */
export const factoryCheckMs = 15_000;

/** One factory of the Factories tab: its role, its slots and the age of its last answer. */
export type FactoryCard = {
	name: string;
	/**
	 * A hub takes runs from its sources, and a daemon builds them. A hub without
	 * boxes builds its own runs, so it is both. Empty before the first good check.
	 */
	roles: FactoryKind[];
	/** The hub whose network holds this box. */
	network?: string;
	/** Null until the first check ends. */
	reachable: boolean | null;
	slots?: Slots;
	/** The clock time of the last good `GET /daemon` read, or of the last hub contact of a pool box. */
	heartbeatAt: string | null;
	/** The host health of a box that answers, from its host samples. */
	host?: HostHealth;
	/** The state of the box in the box pool of a hub. */
	state?: BoxState;
	/** The hub whose box pool lists this box, when no listed factory is the box. */
	hub?: string;
};

const awakeStates: ReadonlySet<BoxState> = new Set(["awake", "stopping"]);

/** A live run of the "Running now" table. */
export type RunningRun = Pick<
	FactoryRun,
	"id" | "factory" | "box" | "statusKind" | "startedAt"
> & {
	key: string;
	project?: string;
	stage?: string;
	/** When the run entered `stage`. */
	stageSince?: string;
	costUsd?: number;
	/** Set when the run is stalled: its time in `stage` passes the p95 of that stage. */
	stall?: { p95S: number };
};

/**
 * A run in "Needs attention": a failed run that nothing resumed or restarted,
 * a stalled run, or an open ask.
 */
export type AttentionItem = {
	kind: "failed" | "stalled" | "ask";
	runId: string;
	key: string;
	factory: string;
	/** The failure reason, the stage of a stalled run, or the ask. */
	reason: string;
	/** When the run failed, passed the p95 of its stage, or asked. */
	since: string;
	/** The p95 of the stage of a stalled run. */
	p95S?: number;
};

/** The durations of one stage over the last `stageDays` days. */
export type StageDuration = {
	stage: string;
	/** An agent stage has turns. A tool stage has none. */
	role: "agent" | "tool";
	/** The runs with an event of the stage. */
	runs: number;
	/** The completed visits of the stage, which give `p50S` and `p95S`. */
	samples: number;
	p50S: number;
	p95S: number;
	retriesPerRun: number;
	/** Null for a stage with no turns. */
	costPerRun: number | null;
};

/** The run results of one day of the outcome chart. */
export type DayOutcome = {
	/** The UTC day, such as `2026-10-25`. */
	day: string;
	merged: number;
	failed: number;
	stopped: number;
};

/** A ticket that waits in the queue of a hub source. */
export type QueueItem = {
	factory: string;
	source: string;
	/** The place of the ticket in the whole queue, from 1, in the start order of each source. */
	rank: number;
	key: string;
	/** The page of the ticket: the tracked ticket's page, else the GitHub issue of a GitHub source. */
	url?: string;
	waits: string;
	since: string | null;
	hold?: { failures: number; since: string };
};

/** A panel that a factory cannot fill, because it answers its route with 404. */
export type NotServedPanel = {
	factory: string;
	panel: "queue" | "host";
	route: string;
};

export type FactoriesPage = {
	/** The server clock time of the answer. */
	at: string;
	tiles: {
		running: number;
		/** The slots of the factories that report them. Null when none does. */
		slots: Slots | null;
		queued: number;
		longestWaitSince: string | null;
		attention: {
			total: number;
			failed: number;
			stalled: number;
			asks: number;
		};
		/** The runs of the last 24 hours, and of the 24 hours before. */
		merged: { last: number; before: number };
		failed: {
			last: number;
			before: number;
			reasons: { reason: string; count: number }[];
		};
		/** The cost of the runs that ended in the last 24 hours, and that cost for each merged PR. */
		cost: { last: number; perMerged: number | null };
	};
	boxes: FactoryCard[];
	running: RunningRun[];
	attention: AttentionItem[];
	queue: QueueItem[];
	notServed: NotServedPanel[];
	/**
	 * The entry graph stages of the last `stageDays` days, slowest p50 first.
	 * The row of a stage that calls a child graph covers the child stages.
	 */
	stages: StageDuration[];
	/** One entry for each of the last `outcomeDays` UTC days, oldest first. */
	outcomes: DayOutcome[];
};

const liveKinds = new Set<FactoryRun["statusKind"]>([
	"starting",
	"running",
	"blocked",
]);

/** The reason of a failed run that names none. */
const unnamedReason = "no reason given";

function cards(
	entries: FactoryEntry[],
	floor: FactoryFloor,
	hostSamples: HostSample[],
	now: Date,
): FactoryCard[] {
	const samples = Map.groupBy(hostSamples, (sample) => sample.factory);
	const healthOf = (name: string, gate: number | null) => {
		const host = hostHealth(samples.get(name) ?? [], gate, now);
		return host === undefined ? {} : { host };
	};
	const listedNames = new Set(entries.map((entry) => entry.name));
	// The pool of a hub that does not answer is its last good one, so a box
	// keeps its card and the page does not reflow; nothing on it is current.
	const pools = entries.flatMap((entry) =>
		(floor.pools.get(entry.url) ?? []).flatMap((box) =>
			box.name === localMachine
				? []
				: [{ hub: entry.name, hubAnswers: entry.reachable === true, box }],
		),
	);
	const pooledIn = new Map(
		pools.map(({ hub, box }) => [box.name, { hub, box }]),
	);
	const rolesOf = (entry: FactoryEntry): FactoryKind[] => {
		if (entry.alsoReadThroughHub !== undefined || pooledIn.has(entry.name)) {
			return ["daemon"];
		}
		if (entry.kind !== "hub") {
			return entry.kind === null ? [] : [entry.kind];
		}
		const pool = floor.pools.get(entry.url) ?? [];
		const buildsItself = pool.some((box) => box.name === localMachine);
		return buildsItself ? ["hub", "daemon"] : ["hub"];
	};
	return entries.flatMap((entry): FactoryCard[] => {
		const pooled = pooledIn.get(entry.name);
		const state = pooled?.box.state;
		const network = pooled?.hub ?? entry.alsoReadThroughHub;
		const card: FactoryCard = {
			name: entry.name,
			roles: rolesOf(entry),
			...(network === undefined ? {} : { network }),
			reachable: entry.reachable,
			...(entry.reachable === true && entry.slots !== undefined
				? { slots: entry.slots }
				: {}),
			heartbeatAt: floor.heartbeats.get(entry.url) ?? null,
			...(entry.reachable === true && !floor.hostsNotServed.has(entry.url)
				? healthOf(entry.name, entry.placementGate ?? null)
				: {}),
			...(state === undefined ? {} : { state }),
		};
		const poolCards = pools.flatMap(
			({ hub, hubAnswers, box }): FactoryCard[] => {
				if (hub !== entry.name || listedNames.has(box.name)) {
					return [];
				}
				const awake = hubAnswers && awakeStates.has(box.state);
				return [
					{
						name: box.name,
						roles: ["daemon"],
						network: hub,
						hub,
						state: box.state,
						reachable: awake,
						...(hubAnswers ? { slots: box.slots } : {}),
						heartbeatAt: box.last_contact,
						...(awake ? healthOf(box.name, null) : {}),
					},
				];
			},
		);
		return [card, ...poolCards];
	});
}

/** The slots of every factory, with a box that a hub also reports counted once, in its hub. */
function slotsOf(boxes: FactoryCard[]): Slots | null {
	const counted = boxes.flatMap((box) =>
		box.network === undefined && box.slots !== undefined ? [box.slots] : [],
	);
	return counted.length === 0
		? null
		: counted.reduce((sum, slots) => ({
				total: sum.total + slots.total,
				used: sum.used + slots.used,
			}));
}

/** A stage duration, with the runs that completed the stage, which decide its stall rule. */
type StageStats = StageDuration & { endedRuns: number };

function stageDurations(
	samples: StageSample[],
	costs: StageCost[],
): StageStats[] {
	const byStage = Map.groupBy(samples, (sample) => sample.stage);
	const costsByStage = Map.groupBy(costs, (cost) => cost.stage);
	return [...byStage]
		.map(([stage, events]): StageStats => {
			const runs = new Set(events.map((event) => event.runId)).size;
			const completions = events.filter(
				(event) =>
					event.event === "stage.completed" && event.durationS !== null,
			);
			const durations = completions.flatMap((event) =>
				event.durationS === null ? [] : [event.durationS],
			);
			const retries = events.filter(
				(event) => event.event === "stage.retrying",
			).length;
			const stageCosts = costsByStage.get(stage) ?? [];
			return {
				stage,
				role: stageCosts.length === 0 ? "tool" : "agent",
				runs,
				endedRuns: new Set(completions.map((event) => event.runId)).size,
				samples: durations.length,
				p50S: percentile(durations, 0.5) ?? 0,
				p95S: percentile(durations, 0.95) ?? 0,
				retriesPerRun: retries / runs,
				costPerRun:
					stageCosts.length === 0
						? null
						: stageCosts.reduce((sum, cost) => sum + cost.costUsd, 0) /
							stageCosts.length,
			};
		})
		.filter((stage) => stage.samples > 0)
		.toSorted(
			(left, right) =>
				right.p50S - left.p50S || left.stage.localeCompare(right.stage),
		);
}

/** The time that a run in a stage since `since` stalls: past the stage p95, and past the stall floor. */
function stallAt(since: string, p95S: number): number {
	return Date.parse(since) + Math.max(p95S * 1_000, stallFloorMs);
}

const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);

function outcomesOf(
	ended: RunHistoryEnd[],
	daysShown: number,
	now: number,
): DayOutcome[] {
	const days = new Map(
		Array.from({ length: daysShown }, (_, index): [string, DayOutcome] => {
			const day = dayOf(now - (daysShown - 1 - index) * dayMs);
			return [day, { day, merged: 0, failed: 0, stopped: 0 }];
		}),
	);
	for (const run of ended) {
		const outcome = days.get(dayOf(Date.parse(run.endedAt)));
		if (outcome === undefined) {
			continue;
		}
		if (run.result === "merged") {
			outcome.merged += 1;
		} else if (run.result === "failed") {
			outcome.failed += 1;
		} else if (run.result === "cancelled") {
			outcome.stopped += 1;
		}
	}
	return [...days.values()];
}

function runningRuns(
	runs: FactoryRun[],
	keys: Map<string, RunListRow>,
	floor: FactoryFloor,
	stages: Map<string, StageStats>,
	now: number,
): RunningRun[] {
	return runs
		.filter((run) => liveKinds.has(run.statusKind) && run.coveredByFeed)
		.map((run) => {
			const row = keys.get(run.id);
			const since = floor.stageSince.get(run.id);
			const stage = run.stage === undefined ? undefined : stages.get(run.stage);
			const stalled =
				stage === undefined ||
				since === undefined ||
				stage.endedRuns < stallRuns
					? null
					: stallAt(since, stage.p95S);
			return {
				id: run.id,
				key: row?.key ?? run.key,
				...(row?.project === undefined ? {} : { project: row.project }),
				factory: run.factory,
				box: run.box,
				statusKind: run.statusKind,
				startedAt: run.startedAt,
				...(run.stage === undefined ? {} : { stage: run.stage }),
				...(run.stage === undefined || since === undefined
					? {}
					: { stageSince: since }),
				...(run.usageTotals === undefined
					? {}
					: { costUsd: run.usageTotals.costUsd }),
				...(stage === undefined || stalled === null || now <= stalled
					? {}
					: { stall: { p95S: stage.p95S } }),
			};
		})
		.toSorted(
			(left, right) =>
				Date.parse(left.startedAt ?? "") - Date.parse(right.startedAt ?? "") ||
				left.id.localeCompare(right.id),
		);
}

function attentionItems(
	runs: FactoryRun[],
	running: RunningRun[],
	keys: Map<string, RunListRow>,
	now: number,
): AttentionItem[] {
	const keyOf = (run: FactoryRun) => keys.get(run.id)?.key ?? run.key;
	const restarted = new Set(runs.flatMap((run) => run.restartedFrom ?? []));
	const failed = runs.flatMap((run): AttentionItem[] => {
		const ended = Date.parse(run.endedAt ?? "");
		const later = runs.some(
			(other) =>
				other.id !== run.id &&
				keyOf(other) === keyOf(run) &&
				Date.parse(other.submittedAt) > Date.parse(run.submittedAt),
		);
		return run.statusKind === "failed" &&
			run.failureReason !== "stopped" &&
			now - ended < dayMs &&
			!restarted.has(run.id) &&
			!later
			? [
					{
						kind: "failed",
						runId: run.id,
						key: keyOf(run),
						factory: run.factory,
						reason: run.failureReason ?? unnamedReason,
						since: run.endedAt ?? run.submittedAt,
					},
				]
			: [];
	});
	const asks = runs.flatMap((run) =>
		(run.questions ?? []).map((question): AttentionItem => ({
			kind: "ask",
			runId: run.id,
			key: keyOf(run),
			factory: run.factory,
			reason: question.text,
			since:
				run.thread?.find(
					(message) =>
						message.kind === "ask" && message.question === question.id,
				)?.at ??
				run.startedAt ??
				run.submittedAt,
		})),
	);
	const stalled = running.flatMap((run): AttentionItem[] =>
		run.stall === undefined ||
		run.stage === undefined ||
		run.stageSince === undefined
			? []
			: [
					{
						kind: "stalled",
						runId: run.id,
						key: run.key,
						factory: run.factory,
						reason: run.stage,
						since: new Date(
							stallAt(run.stageSince, run.stall.p95S),
						).toISOString(),
						p95S: run.stall.p95S,
					},
				],
	);
	return [...asks, ...stalled, ...failed].toSorted(
		(left, right) => Date.parse(right.since) - Date.parse(left.since),
	);
}

function queueOf(
	entries: FactoryEntry[],
	floor: FactoryFloor,
	ticketUrls: ReadonlyMap<string, string>,
): { queue: QueueItem[]; notServed: NotServedPanel[] } {
	const queue: QueueItem[] = [];
	const notServed: NotServedPanel[] = [];
	for (const entry of entries) {
		if (floor.hostsNotServed.has(entry.url)) {
			notServed.push({
				factory: entry.name,
				panel: "host",
				route: `GET ${hostRoute}`,
			});
		}
		const sources = floor.queues.get(entry.url);
		if (sources === "not served") {
			notServed.push({
				factory: entry.name,
				panel: "queue",
				route: "GET /sources",
			});
			continue;
		}
		for (const source of sources ?? []) {
			for (const ticket of source.tickets) {
				const numbered =
					source.repo !== null && /^\d+$/.test(ticket.ticket)
						? source.repo
						: null;
				const key =
					numbered === null
						? ticket.ticket
						: numberedKey(numbered, ticket.ticket);
				const url =
					ticketUrls.get(key) ??
					(numbered !== null && source.tracker === "github"
						? `https://github.com/${numbered}/issues/${ticket.ticket}`
						: undefined);
				queue.push({
					factory: entry.name,
					source: source.source,
					rank: queue.length + 1,
					key,
					...(url === undefined ? {} : { url }),
					waits: ticket.waits,
					since: ticket.since,
					...(ticket.hold === undefined ? {} : { hold: ticket.hold }),
				});
			}
		}
	}
	return { queue, notServed };
}

/** The merges, failures and cost of the ended runs of the run history in two 24-hour windows. */
function endTiles(ended: RunHistoryEnd[], now: number) {
	const last = ended.filter((run) => now - Date.parse(run.endedAt) < dayMs);
	const before = ended.filter((run) => {
		const age = now - Date.parse(run.endedAt);
		return age >= dayMs && age < 2 * dayMs;
	});
	const merged = (runs: RunHistoryEnd[]) =>
		runs.filter((run) => run.result === "merged").length;
	const failures = (runs: RunHistoryEnd[]) =>
		runs.filter((run) => run.result === "failed");
	const reasons = new Map<string, number>();
	for (const run of failures(last)) {
		const reason = run.reason ?? unnamedReason;
		reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
	}
	const cost = last.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
	const mergedLast = merged(last);
	return {
		merged: { last: mergedLast, before: merged(before) },
		failed: {
			last: failures(last).length,
			before: failures(before).length,
			reasons: [...reasons]
				.map(([reason, count]) => ({ reason, count }))
				.toSorted(
					(left, right) =>
						right.count - left.count || left.reason.localeCompare(right.reason),
				),
		},
		cost: {
			last: cost,
			perMerged: mergedLast === 0 ? null : cost / mergedLast,
		},
	};
}

/** The stage events of some days of run history, and the turn cost of their runs. */
export type StageWindow = { samples: StageSample[]; costs: StageCost[] };

/** The Factories tab: what each factory runs now, what needs attention, and the queue. */
export function factoriesPage(input: {
	entries: FactoryEntry[];
	floor: FactoryFloor;
	runs: FactoryRun[];
	rows: RunListRow[];
	/** The runs of the run history that ended in the outcome chart's days or in the last 48 hours. */
	ended: RunHistoryEnd[];
	/** The days of the outcome chart, today included. */
	outcomeDays: number;
	/** The stage events of the last `stageDays` days, and the turn cost of their runs, for the stall rule. */
	stall: StageWindow;
	/** The stage events and turn costs of the days the stage durations show. */
	shown: StageWindow;
	/** The host samples of the last `growthSpanMs`, oldest first. */
	hostSamples: HostSample[];
	/** The page of each tracked ticket by its key. */
	ticketUrls: ReadonlyMap<string, string>;
	now: Date;
}): FactoriesPage {
	const now = input.now.getTime();
	const keys = new Map(input.rows.map((row) => [row.id, row]));
	const boxes = cards(input.entries, input.floor, input.hostSamples, input.now);
	const stages = stageDurations(input.stall.samples, input.stall.costs);
	const shown =
		input.shown === input.stall
			? stages
			: stageDurations(input.shown.samples, input.shown.costs);
	const running = runningRuns(
		input.runs,
		keys,
		input.floor,
		new Map(stages.map((stage) => [stage.stage, stage])),
		now,
	);
	const attention = attentionItems(input.runs, running, keys, now);
	const count = (kind: AttentionItem["kind"]) =>
		attention.filter((item) => item.kind === kind).length;
	const { queue, notServed } = queueOf(
		input.entries,
		input.floor,
		input.ticketUrls,
	);
	const waits = queue.flatMap((item) =>
		item.since === null ? [] : [item.since],
	);
	return {
		at: input.now.toISOString(),
		tiles: {
			running: running.length,
			slots: slotsOf(boxes),
			queued: queue.length,
			longestWaitSince:
				waits.toSorted(
					(left, right) => Date.parse(left) - Date.parse(right),
				)[0] ?? null,
			attention: {
				total: attention.length,
				failed: count("failed"),
				stalled: count("stalled"),
				asks: count("ask"),
			},
			...endTiles(input.ended, now),
		},
		boxes,
		running,
		attention,
		queue,
		notServed,
		stages: shown.flatMap(({ endedRuns: _, ...stage }) =>
			stage.stage.includes("/") ? [] : [stage],
		),
		outcomes: outcomesOf(input.ended, input.outcomeDays, now),
	};
}
