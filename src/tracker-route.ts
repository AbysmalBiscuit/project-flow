import type { PollOptions } from "./app.ts";
import type { Tracker } from "./ports.ts";

export type Trackers = Pick<PollOptions, "github" | "linear">;

export function trackerFor(
	trackers: Trackers,
	name: string,
): Tracker | null | undefined {
	if (name === "github") {
		return trackers.github;
	}
	if (name === "linear") {
		return trackers.linear;
	}
	return null;
}

export function trackerError(error: unknown): Response {
	const message = error instanceof Error ? error.message : "reply failed";
	const status =
		error instanceof Error &&
		"status" in error &&
		typeof error.status === "number"
			? error.status
			: 502;
	return Response.json({ error: message }, { status });
}
