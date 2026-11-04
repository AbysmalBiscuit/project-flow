import type { FactoryRun } from "./domain.ts";
import type { FactoryEntry, FactoryFloor } from "./factories.ts";
import type { Slots } from "./factory-kind.ts";
import type { RunHistoryEnd } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";
import { numberedKey } from "./ticket-key.ts";

const dayMs = 24 * 60 * 60 * 1_000;

/** How often an open Factories tab checks each factory again, which also reads each hub queue. */
export const factoryCheckMs = 15_000;

/** One factory of the Factories tab: its role, its slots and the age of its last answer. */
export type FactoryCard = {
	name: string;
	/** A box is a factory whose runs a listed hub also reports. Null before the first good check. */
	role: "hub" | "daemon" | "box" | null;
	/** Null until the first check ends. */
	reachable: boolean | null;
	slots?: Slots;
	/** The clock time of the last good `GET /daemon` read. */
	heartbeatAt: string | null;
};

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
};

/** A run in "Needs attention": a failed run that nothing resumed or restarted, or an open ask. */
export type AttentionItem = {
	kind: "failed" | "ask";
	runId: string;
	key: string;
	factory: string;
	reason: string;
	/** When the run failed, or when the run asked. */
	since: string;
};

/** A ticket that waits in the queue of a hub source. */
export type QueueItem = {
	factory: string;
	source: string;
	/** The place of the ticket in the start order of its source, from 1. */
	rank: number;
	key: string;
	waits: string;
	since: string | null;
	hold?: { failures: number; since: string };
};

/** A panel that a factory cannot fill, because it answers its route with 404. */
export type NotServedPanel = { factory: string; panel: "queue"; route: string };

export type FactoriesPage = {
	/** The server clock time of the answer. */
	at: string;
	tiles: {
		running: number;
		/** The slots of the factories that report them. Null when none does. */
		slots: Slots | null;
		queued: number;
		longestWaitSince: string | null;
		attention: { total: number; failed: number; asks: number };
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
};

const liveKinds = new Set<FactoryRun["statusKind"]>([
	"starting",
	"running",
	"blocked",
]);

/** The reason of a failed run that names none. */
const unnamedReason = "no reason given";

function cards(entries: FactoryEntry[], floor: FactoryFloor): FactoryCard[] {
	return entries.map((entry) => ({
		name: entry.name,
		role: entry.alsoReadThroughHub === undefined ? entry.kind : "box",
		reachable: entry.reachable,
		...(entry.reachable === true && entry.slots !== undefined
			? { slots: entry.slots }
			: {}),
		heartbeatAt: floor.heartbeats.get(entry.url) ?? null,
	}));
}

/** The slots of every factory, with a box that a hub also reports counted once, in its hub. */
function slotsOf(boxes: FactoryCard[]): Slots | null {
	const counted = boxes.flatMap((box) =>
		box.role !== "box" && box.slots !== undefined ? [box.slots] : [],
	);
	return counted.length === 0
		? null
		: counted.reduce((sum, slots) => ({
				total: sum.total + slots.total,
				used: sum.used + slots.used,
			}));
}

function runningRuns(
	runs: FactoryRun[],
	keys: Map<string, RunListRow>,
	floor: FactoryFloor,
): RunningRun[] {
	return runs
		.filter((run) => liveKinds.has(run.statusKind) && run.coveredByFeed)
		.map((run) => {
			const row = keys.get(run.id);
			const since = floor.stageSince.get(run.id);
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
	return [...asks, ...failed].toSorted(
		(left, right) => Date.parse(right.since) - Date.parse(left.since),
	);
}

function queueOf(
	entries: FactoryEntry[],
	floor: FactoryFloor,
): { queue: QueueItem[]; notServed: NotServedPanel[] } {
	const queue: QueueItem[] = [];
	const notServed: NotServedPanel[] = [];
	for (const entry of entries) {
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
			source.tickets.forEach((ticket, index) => {
				queue.push({
					factory: entry.name,
					source: source.source,
					rank: index + 1,
					key:
						source.repo !== null && /^\d+$/.test(ticket.ticket)
							? numberedKey(source.repo, ticket.ticket)
							: ticket.ticket,
					waits: ticket.waits,
					since: ticket.since,
					...(ticket.hold === undefined ? {} : { hold: ticket.hold }),
				});
			});
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

/** The Factories tab: what each factory runs now, what needs Lev, and the queue. */
export function factoriesPage(input: {
	entries: FactoryEntry[];
	floor: FactoryFloor;
	runs: FactoryRun[];
	rows: RunListRow[];
	/** The runs of the run history that ended in the last 48 hours. */
	ended: RunHistoryEnd[];
	now: Date;
}): FactoriesPage {
	const now = input.now.getTime();
	const keys = new Map(input.rows.map((row) => [row.id, row]));
	const boxes = cards(input.entries, input.floor);
	const running = runningRuns(input.runs, keys, input.floor);
	const attention = attentionItems(input.runs, keys, now);
	const { queue, notServed } = queueOf(input.entries, input.floor);
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
				failed: attention.filter((item) => item.kind === "failed").length,
				asks: attention.filter((item) => item.kind === "ask").length,
			},
			...endTiles(input.ended, now),
		},
		boxes,
		running,
		attention,
		queue,
		notServed,
	};
}
