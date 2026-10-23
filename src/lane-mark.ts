import { board } from "./board-styles.ts";
import type { StatusType } from "./domain.ts";
import { lightValues } from "./tokens.stylex.ts";

const statusMarks: Record<StatusType, typeof board.markBacklog> = {
	done: board.markDone,
	dropped: board.markDropped,
	backlog: board.markBacklog,
	inProgress: board.markInProgress,
	inReview: board.markInReview,
	awaitingMerge: board.markAwaitingMerge,
};

const laneMarks: Record<string, typeof board.markBacklog> = {
	[lightValues.done.toLowerCase()]: board.markDone,
	[lightValues.dropped.toLowerCase()]: board.markDropped,
	[lightValues.blocked.toLowerCase()]: board.markBlocked,
	[lightValues.backlog.toLowerCase()]: board.markBacklog,
	[lightValues.inProgress.toLowerCase()]: board.markInProgress,
	[lightValues.inReview.toLowerCase()]: board.markInReview,
	[lightValues.awaitingMerge.toLowerCase()]: board.markAwaitingMerge,
};

export function laneMark(colour: string, statusType?: StatusType) {
	return (
		(statusType === undefined ? undefined : statusMarks[statusType]) ??
		laneMarks[colour.trim().toLowerCase()] ??
		board.markBacklog
	);
}
