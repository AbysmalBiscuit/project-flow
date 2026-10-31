import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import type { StatusColours } from "./domain.ts";
import { categoryColours, defaultStates } from "./lane-views.ts";
import { pageQuery, pageQueryClient } from "./queries.ts";
import { readStoredStateColours, storedObject } from "./stored-page.ts";
import { stateColours, stateValues } from "./tokens.stylex.ts";

const defaultStateColours: StatusColours = stateValues;

/** The states a fresh configuration file holds. */
export const shippedStates = defaultStates(defaultStateColours);

/** Finds the colour of a user state by its label, the name of its lane. */
export function useLaneColour(): (
	lane: string | undefined,
) => string | undefined {
	const states = useQuery(pageQuery.settings).data?.states ?? [];
	return (lane) => {
		const name = lane?.toLowerCase();
		return states.find((state) => state.label.toLowerCase() === name)?.colour;
	};
}

const paint = stylex.create({
	states: (
		backlog: string,
		inProgress: string,
		inReview: string,
		awaitingMerge: string,
		done: string,
		dropped: string,
	) => ({
		[stateColours.backlog]: backlog,
		[stateColours.inProgress]: inProgress,
		[stateColours.inReview]: inReview,
		[stateColours.awaitingMerge]: awaitingMerge,
		[stateColours.done]: done,
		[stateColours.dropped]: dropped,
	}),
});

const hex = /^#[0-9a-f]{6}$/i;

function coloursOf(body: unknown): StatusColours | null {
	const value = storedObject(body);
	if (value === null) {
		return null;
	}
	const read = (key: keyof StatusColours): string => {
		const colour = value[key];
		return typeof colour === "string" && hex.test(colour)
			? colour
			: defaultStateColours[key];
	};
	return {
		backlog: read("backlog"),
		inProgress: read("inProgress"),
		inReview: read("inReview"),
		awaitingMerge: read("awaitingMerge"),
		done: read("done"),
		dropped: read("dropped"),
	};
}

/**
 * Sets the state colour variables on the root element, so every view, the
 * jump box and the side panel draw each state in the configured colour.
 */
function applyStateColours(colours: StatusColours): void {
	const { className, style } = stylex.props(
		paint.states(
			colours.backlog,
			colours.inProgress,
			colours.inReview,
			colours.awaitingMerge,
			colours.done,
			colours.dropped,
		),
	);
	const element = document.documentElement;
	for (const token of (className ?? "").split(" ")) {
		if (token !== "") {
			element.classList.add(token);
		}
	}
	for (const [name, value] of Object.entries(style ?? {})) {
		element.style.setProperty(name, String(value));
	}
}

/** Paints the colours the server embedded, then follows each settings read. */
export function watchStateColours(): void {
	const stored = coloursOf(readStoredStateColours());
	if (stored !== null) {
		applyStateColours(stored);
	}
	const key = JSON.stringify(pageQuery.settings.queryKey);
	pageQueryClient.getQueryCache().subscribe((event) => {
		if (
			event.type !== "updated" ||
			JSON.stringify(event.query.queryKey) !== key
		) {
			return;
		}
		const states = event.query.state.data?.states;
		if (states !== undefined) {
			applyStateColours(categoryColours(states));
		}
	});
}
