import * as stylex from "@stylexjs/stylex";

import type { StatusType } from "./domain.ts";
import { colours, stateColours, stateTone } from "./tokens.stylex.ts";

/**
 * One style per state. Each sets `stateTone.tone` and `stateTone.wash`, and
 * a view reads only those two variables. The wash tints the raised surface
 * with the tone, so one configured colour serves both themes.
 */
export const stateTones = stylex.create({
	backlog: {
		[stateTone.tone]: stateColours.backlog,
		[stateTone.wash]: `color-mix(in srgb, ${stateColours.backlog} ${colours.washMix}, ${colours.raised})`,
	},
	inProgress: {
		[stateTone.tone]: stateColours.inProgress,
		[stateTone.wash]: `color-mix(in srgb, ${stateColours.inProgress} ${colours.washMix}, ${colours.raised})`,
	},
	inReview: {
		[stateTone.tone]: stateColours.inReview,
		[stateTone.wash]: `color-mix(in srgb, ${stateColours.inReview} ${colours.washMix}, ${colours.raised})`,
	},
	awaitingMerge: {
		[stateTone.tone]: stateColours.awaitingMerge,
		[stateTone.wash]: `color-mix(in srgb, ${stateColours.awaitingMerge} ${colours.washMix}, ${colours.raised})`,
	},
	done: {
		[stateTone.tone]: stateColours.done,
		[stateTone.wash]: `color-mix(in srgb, ${stateColours.done} ${colours.washMix}, ${colours.raised})`,
	},
	dropped: {
		[stateTone.tone]: stateColours.dropped,
		[stateTone.wash]: `color-mix(in srgb, ${stateColours.dropped} ${colours.washMix}, ${colours.raised})`,
	},
}) satisfies Record<StatusType, unknown>;

export function toneOf(state: StatusType | undefined) {
	return stateTones[state ?? "backlog"];
}

const painted = stylex.create({
	tone: (tone: string) => ({
		[stateTone.tone]: tone,
		[stateTone.wash]: `color-mix(in srgb, ${tone} ${colours.washMix}, ${colours.raised})`,
	}),
});

/**
 * The class and style props that tone an element in a user state colour. An
 * element with no known colour falls back to the colour of its category.
 */
export function tonedProps(
	colour: string | undefined,
	state: StatusType | undefined,
	...styles: stylex.StyleXStyles[]
) {
	return stylex.props(
		...styles,
		colour === undefined ? toneOf(state) : painted.tone(colour),
	);
}
