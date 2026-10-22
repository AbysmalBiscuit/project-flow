import { board } from "./board-styles.ts";
import type { StatusType } from "./domain.ts";

export const cardTones: Record<StatusType, typeof board.cardBacklog> = {
	backlog: board.cardBacklog,
	inProgress: board.cardProgress,
	inReview: board.cardReview,
	awaitingMerge: board.cardMerge,
	done: board.cardDone,
	dropped: board.cardDropped,
};
