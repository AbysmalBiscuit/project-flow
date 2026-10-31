import type { Configuration, UserState } from "./configuration.ts";
import type {
	Board,
	Lane,
	StatusColours,
	StatusType,
	Ticket,
	TicketState,
} from "./domain.ts";
import { statusTypes } from "./kinds.ts";
import { appLaneNames } from "./lane-views.ts";

const statusTypeOrder: readonly StatusType[] = statusTypes;

const factoryLabels = [
	"ready",
	"factory: running",
	"factory: in-review",
] as const;

const reviewNames = new Set([
	"in review",
	"in-review",
	"review",
	"factory: in-review",
]);

const progressNames = new Set([
	"in progress",
	"in-progress",
	"doing",
	"started",
	"factory: running",
]);

const awaitingNames = new Set([
	"awaiting merge",
	"awaiting-merge",
	"ready to merge",
	"ready for merge",
]);

const doneNames = new Set(["done", "completed", "shipped", "merged"]);

const droppedNames = new Set([
	"dropped",
	"canceled",
	"cancelled",
	"duplicate",
	"won't do",
	"wont do",
]);

export {
	appLaneNames,
	categoryColours,
	defaultStates,
	displayedLaneName,
	doneTicketsForLane,
} from "./lane-views.ts";

function laneName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function appLane(statusType: StatusType, colours: StatusColours): Lane {
	return {
		id: statusType,
		name: appLaneNames[statusType],
		colour: colours[statusType],
		statusType,
	};
}

export function appLanes(colours: StatusColours): Lane[] {
	return statusTypeOrder.map((statusType) => appLane(statusType, colours));
}

export function statusTypeOfName(name: string): StatusType {
	const lowered = laneName(name);
	if (reviewNames.has(lowered)) {
		return "inReview";
	}
	if (awaitingNames.has(lowered)) {
		return "awaitingMerge";
	}
	if (progressNames.has(lowered)) {
		return "inProgress";
	}
	if (doneNames.has(lowered)) {
		return "done";
	}
	if (droppedNames.has(lowered)) {
		return "dropped";
	}
	return "backlog";
}

export function linearStatusType(type: string, name: string): StatusType {
	if (type === "completed") {
		return "done";
	}
	if (type === "canceled" || type === "duplicate") {
		return "dropped";
	}
	if (type === "started") {
		const named = statusTypeOfName(name);
		if (named === "inReview" || named === "awaitingMerge") {
			return named;
		}
		return "inProgress";
	}
	return "backlog";
}

function namesMatch(left: string, right: string): boolean {
	return laneName(left) === laneName(right);
}

function mappedEvidence(
	mapping: LaneMapping,
	name: string,
): StatusType | undefined {
	for (const statusType of statusTypeOrder) {
		const mapped = mapping[statusType];
		if (mapped !== undefined && namesMatch(mapped, name)) {
			return statusType;
		}
	}
	return undefined;
}

function insertAwaitingMerge(lanes: Lane[], colours: StatusColours): Lane[] {
	if (
		lanes.some(
			(lane) =>
				lane.evidence === "awaitingMerge" ||
				awaitingNames.has(laneName(lane.name)),
		)
	) {
		return lanes;
	}
	const review = lanes.findLastIndex(
		(lane) =>
			lane.statusType === "inReview" || reviewNames.has(laneName(lane.name)),
	);
	const added: Lane = {
		id: "awaiting-merge",
		name: appLaneNames.awaitingMerge,
		colour: colours.awaitingMerge,
		statusType: "awaitingMerge",
		added: true,
	};
	const at = review === -1 ? laneInsertAt(lanes, "awaitingMerge") : review + 1;
	return [...lanes.slice(0, at), added, ...lanes.slice(at)];
}

type LaneMapping = Configuration["laneMappings"][string];

function trackerLanes(board: Board | undefined): boolean {
	if (board === undefined) {
		return false;
	}
	if (board.kind === "github-repo") {
		return board.factoryLabels;
	}
	return board.statuses.length > 0;
}

export function lanesFor(
	board: Board | undefined,
	mapping: LaneMapping,
	colours: StatusColours,
): Lane[] {
	if (!trackerLanes(board) || board === undefined) {
		return appLanes(colours);
	}
	const lanes = board.statuses.map((status) => {
		const evidence = mappedEvidence(mapping, status.name);
		const lane: Lane = {
			id: status.id,
			name: status.name,
			colour: status.colour,
			statusType: status.statusType,
		};
		if (evidence !== undefined) {
			lane.evidence = evidence;
		}
		return lane;
	});
	return insertAwaitingMerge(lanes, colours);
}

export function laneForTicket(
	ticket: Ticket,
	lanes: Lane[],
	colours: StatusColours,
): Lane {
	if (ticket.emptyStatus === true) {
		return laneOfType(lanes, closedLaneType(ticket) ?? "backlog", colours);
	}
	const matched =
		ticket.status === undefined ? undefined : laneOfStatus(ticket, lanes);
	const closedType = closedLaneType(ticket);
	if (closedType !== undefined) {
		if (matched?.statusType === closedType) {
			return matched;
		}
		return laneOfType(lanes, closedType, colours);
	}
	if (matched !== undefined) {
		return matched;
	}
	if (ticket.status === undefined) {
		return laneOfType(lanes, "backlog", colours);
	}
	return laneOfType(lanes, ticket.status.statusType, colours);
}

function laneOfType(
	lanes: Lane[],
	statusType: StatusType,
	colours: StatusColours,
): Lane {
	return (
		lanes.find((lane) => lane.statusType === statusType) ??
		appLane(statusType, colours)
	);
}

export function placeOnBoard(
	lanes: Lane[],
	tickets: Ticket[],
	colours: StatusColours,
): Lane[] {
	const placed = [...lanes];
	for (const ticket of tickets) {
		const statusType = laneForTicket(ticket, placed, colours).statusType;
		if (placed.some((lane) => lane.statusType === statusType)) {
			continue;
		}
		placed.splice(laneInsertAt(placed, statusType), 0, {
			...appLane(statusType, colours),
			added: true,
		});
	}
	return placed;
}

function laneInsertAt(lanes: Lane[], statusType: StatusType): number {
	const order = statusTypeOrder.indexOf(statusType);
	const after = lanes.findLastIndex(
		(lane) => statusTypeOrder.indexOf(lane.statusType) < order,
	);
	return after + 1;
}

export function closedLaneType(ticket: Ticket): StatusType | undefined {
	if (ticket.state !== "closed") {
		return undefined;
	}
	return closedStatusType(ticket.stateReason);
}

export function closedStatusType(stateReason: string | null): StatusType {
	return closedReasons.has(stateReason ?? "") ? "dropped" : "done";
}

function laneOfStatus(ticket: Ticket, lanes: Lane[]): Lane | undefined {
	const status = ticket.status;
	if (status === undefined) {
		return undefined;
	}
	return (
		lanes.find((lane) => lane.id === status.id) ??
		lanes.find((lane) => namesMatch(lane.name, status.name))
	);
}

function factoryLaneType(name: string): StatusType {
	if (name === "ready") {
		return "backlog";
	}
	if (name === "factory: running") {
		return "inProgress";
	}
	return "inReview";
}

export function factoryBoard(
	labels: { name: string; colour: string }[],
): Board {
	const present = factoryLabels.flatMap((name) => {
		const label = labels.find((item) => item.name === name);
		return label === undefined ? [] : [label];
	});
	return {
		kind: "github-repo",
		factoryLabels: present.length === factoryLabels.length,
		statuses: present.map((label) => ({
			id: label.name,
			name: label.name,
			colour: label.colour,
			statusType: factoryLaneType(label.name),
		})),
	};
}

export const emptyStatusTypes = (): Record<StatusType, number> => ({
	backlog: 0,
	inProgress: 0,
	inReview: 0,
	awaitingMerge: 0,
	done: 0,
	dropped: 0,
});

const closedReasons = new Set(["not_planned", "duplicate", "canceled"]);

export function laterState(
	current: TicketState,
	next: TicketState,
): TicketState {
	const currentAt = statusTypeOrder.indexOf(current);
	const nextAt = statusTypeOrder.indexOf(next);
	return nextAt > currentAt ? next : current;
}

/** The board columns: one lane per user state, in the user's order. */
export function stateLanes(states: readonly UserState[]): Lane[] {
	return states.map((state) => ({
		id: state.id,
		name: state.label,
		colour: state.colour,
		statusType: state.categories[0] ?? "backlog",
	}));
}

export type StateMapping = Configuration["stateMappings"][string];

/**
 * The user state of a ticket. A tracker status or label that the source maps
 * to a state places the ticket there. Evidence that moves the ticket past its
 * tracker category overrides a mapped state that does not hold the new
 * category. Otherwise the first state of the ticket's category holds it.
 */
export function stateOfTicket(
	states: readonly UserState[],
	mapping: StateMapping,
	names: readonly string[],
	category: StatusType,
	trackerCategory: StatusType,
): UserState | undefined {
	for (const name of names) {
		const id = Object.entries(mapping).find(([mapped]) =>
			namesMatch(mapped, name),
		)?.[1];
		const state = states.find((item) => item.id === id);
		if (
			state !== undefined &&
			(category === trackerCategory || state.categories.includes(category))
		) {
			return state;
		}
	}
	return states.find((state) => state.categories.includes(category));
}
