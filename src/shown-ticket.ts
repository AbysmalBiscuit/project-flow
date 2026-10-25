import type {
	EarlierFactoryRun,
	FactoryRun,
	Lane,
	LiveRun,
	PullRequest,
	RunStatusKind,
	ShownFactoryRun,
	ShownTicket,
	Ticket,
	WorkcellRun,
} from "./domain.ts";
import { appLaneNames, closedLaneType, laterState } from "./lanes.ts";
import { branchLinksTicket, closesTicket } from "./links.ts";
import { sameTicketKey } from "./ticket-key.ts";
import { progressRun, runFor, runsFor } from "./workcell.ts";

function enteredStateAt(ticket: Ticket, lane: Lane): string {
	const history = ticket.history ?? [];
	let entered: string | undefined;
	for (const change of history) {
		const sameLane = change.statusId === lane.id;
		const sameType =
			change.statusType !== undefined && change.statusType === lane.statusType;
		if ((sameLane || sameType) && change.at !== "") {
			entered =
				entered === undefined || change.at > entered ? change.at : entered;
		}
	}
	const closedType = closedLaneType(ticket);
	const closedAt = ticket.closedAt;
	if (
		closedType !== undefined &&
		closedType === lane.statusType &&
		closedAt !== undefined &&
		closedAt !== "" &&
		(entered === undefined || closedAt > entered)
	) {
		entered = closedAt;
	}
	if (entered !== undefined) {
		return entered;
	}
	if (lane.statusType === "backlog") {
		const createdAt = ticket.createdAt?.trim() ?? "";
		if (createdAt !== "") {
			return createdAt;
		}
	}
	return ticket.updatedAt;
}

/** The live run status of a factory run. A queued or ended run has none. */
const feedStatus: Record<RunStatusKind, LiveRun["status"] | undefined> = {
	queued: undefined,
	starting: "running",
	running: "running",
	blocked: "running",
	failed: "failed",
	succeeded: undefined,
};

/**
 * The run evidence of a ticket. A run that the factory feed covers wins over
 * a local run, and a local run wins over the progress comment.
 */
function liveRun(
	ticket: Ticket,
	runs: WorkcellRun[],
	fed: FactoryRun | undefined,
	now: Date,
): LiveRun | undefined {
	const fromComment = progressRun(ticket.comments ?? [], now);
	const local = runFor(ticket, runs);
	if (fed === undefined && local === undefined) {
		return fromComment;
	}
	const status = fed === undefined ? local?.status : feedStatus[fed.statusKind];
	const stage = fromComment?.stage;
	return status === undefined
		? undefined
		: { status, ...(stage === undefined ? {} : { stage }) };
}

export function shownTicket(
	ticket: Ticket,
	lane: Lane,
	links: PullRequest[],
	branches: string[],
	startedKeys: string[],
	review: { state: "inReview" | "awaitingMerge" | null },
	runs: WorkcellRun[],
	fed: FactoryRun | undefined,
	autoMerge: boolean,
	lanes: Lane[],
	now: Date,
	openBlockerCount: number,
): ShownTicket {
	const trackerState = lane.statusType;
	let state = trackerState;
	const key = ticket.key;
	const started =
		key !== null && startedKeys.some((item) => sameTicketKey(item, key));
	const pushed =
		key !== null && branches.some((branch) => branchLinksTicket(branch, key));
	const draft = links.some((pull) => pull.draft);
	const run = liveRun(ticket, runs, fed, now);
	const live = run?.status === "running";
	const mergedClose = links.some(
		(pull) => pull.merged && closesTicket(pull, ticket),
	);
	const failed = run?.status === "failed" && !mergedClose;
	const open = links.filter((pull) => !pull.merged);
	if (
		!failed &&
		ticket.state === "open" &&
		(draft || pushed || started || (live && open.length === 0))
	) {
		state = laterState(state, "inProgress");
	}
	if (!failed && ticket.state === "open" && review.state !== null) {
		const reviewed =
			review.state === "awaitingMerge" && autoMerge ? "inReview" : review.state;
		state = laterState(state, reviewed);
	}
	if (ticket.state === "open" && mergedClose) {
		state = laterState(state, "done");
	}
	const shownLane =
		failed || state === trackerState
			? lane
			: (lanes.find(
					(item) =>
						item.statusType === state && item.name === appLaneNames[state],
				) ??
				lanes.find((item) => item.statusType === state) ??
				lane);
	const chips: string[] = [];
	let staleStatus: string | undefined;
	if (
		ticket.status !== undefined &&
		shownLane.statusType !== ticket.status.statusType &&
		ticket.status.name !== ""
	) {
		staleStatus = ticket.status.name;
		chips.push(staleStatus);
	}
	const runFailed =
		failed && ticket.state === "open" && shownLane.statusType !== "done";
	if (runFailed) {
		chips.push("Run failed");
	}
	const shownRun =
		run !== undefined && ticket.state === "open" && (live || failed)
			? run
			: undefined;
	return {
		state: shownLane.statusType,
		lane: shownLane,
		...(staleStatus === undefined ? {} : { staleStatus }),
		chips,
		runFailed,
		enteredStateAt: enteredStateAt(ticket, shownLane),
		blocked: ticket.state === "open" && openBlockerCount > 0,
		...(shownRun === undefined ? {} : { run: shownRun }),
	};
}

/**
 * The newest factory run of a ticket, with the stage of its progress comment,
 * and the earlier runs of the ticket.
 */
export function shownFactoryRun(
	ticket: Ticket,
	newestFirst: FactoryRun[],
	now: Date,
):
	| { factoryRun: ShownFactoryRun; earlierFactoryRuns?: EarlierFactoryRun[] }
	| Record<string, never> {
	const [run, ...earlier] = runsFor(ticket, newestFirst);
	if (run === undefined) {
		return {};
	}
	const stage = progressRun(ticket.comments ?? [], now)?.stage;
	return {
		factoryRun: {
			id: run.id,
			statusKind: run.statusKind,
			box: run.box,
			factory: run.factory,
			...(run.source === undefined ? {} : { source: run.source }),
			...(run.rule === undefined ? {} : { rule: run.rule }),
			startedAt: run.startedAt,
			endedAt: run.endedAt,
			coveredByFeed: run.coveredByFeed,
			...(run.questions === undefined ? {} : { questions: run.questions }),
			...(stage === undefined ? {} : { stage }),
		},
		...(earlier.length === 0
			? {}
			: {
					earlierFactoryRuns: earlier.map((run) => ({
						statusKind: run.statusKind,
						startedAt: run.startedAt,
						endedAt: run.endedAt,
					})),
				}),
	};
}

export function assigneesOf(
	ticket: Ticket,
): { assignees: string[] } | Record<string, never> {
	const names = [
		...(ticket.assignees ?? []),
		...(ticket.assignee === undefined || ticket.assignee === null
			? []
			: [ticket.assignee]),
	].flatMap((name) => {
		const trimmed = name.trim();
		return trimmed === "" ? [] : [trimmed];
	});
	return names.length === 0 ? {} : { assignees: [...new Set(names)] };
}

export function chipsOf(
	shown: ShownTicket,
): { chips: string[] } | Record<string, never> {
	const chips = shown.blocked ? [...shown.chips, "Blocked"] : shown.chips;
	return chips.length === 0 ? {} : { chips };
}
