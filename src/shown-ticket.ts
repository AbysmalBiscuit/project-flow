import type {
	Lane,
	PullRequest,
	ShownTicket,
	Ticket,
	WorkcellRun,
} from "./domain.ts";
import { appLaneNames, closedLaneType, laterState } from "./lanes.ts";
import { branchLinksTicket, closesTicket } from "./links.ts";
import { sameTicketKey } from "./ticket-key.ts";
import { progressRun, runFor } from "./workcell.ts";

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

export function shownTicket(
	ticket: Ticket,
	lane: Lane,
	links: PullRequest[],
	branches: string[],
	startedKeys: string[],
	review: { state: "inReview" | "awaitingMerge" | null },
	runs: WorkcellRun[],
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
	const local = runFor(ticket, runs);
	const fromComment = progressRun(ticket.comments ?? [], now);
	const stage = fromComment?.stage;
	const run =
		local === undefined
			? fromComment
			: {
					status: local.status,
					...(stage === undefined ? {} : { stage }),
				};
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
