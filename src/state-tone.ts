import * as stylex from "@stylexjs/stylex";
import type { StatusType } from "./domain.ts";
import { colours, stateTone } from "./tokens.stylex.ts";

/**
 * One style per state. Each sets `stateTone.tone` and `stateTone.wash`, and
 * a view reads only those two variables.
 */
export const stateTones = stylex.create({
	backlog: {
		[stateTone.tone]: colours.backlog,
		[stateTone.wash]: colours.backlogWash,
	},
	inProgress: {
		[stateTone.tone]: colours.inProgress,
		[stateTone.wash]: colours.inProgressWash,
	},
	inReview: {
		[stateTone.tone]: colours.inReview,
		[stateTone.wash]: colours.inReviewWash,
	},
	awaitingMerge: {
		[stateTone.tone]: colours.awaitingMerge,
		[stateTone.wash]: colours.awaitingMergeWash,
	},
	done: {
		[stateTone.tone]: colours.done,
		[stateTone.wash]: colours.doneWash,
	},
	dropped: {
		[stateTone.tone]: colours.dropped,
		[stateTone.wash]: colours.droppedWash,
	},
}) satisfies Record<StatusType, unknown>;

export function toneOf(state: StatusType | undefined) {
	return stateTones[state ?? "backlog"];
}
