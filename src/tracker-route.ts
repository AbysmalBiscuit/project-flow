import { type TrackerKind, trackerKinds } from "./domain.ts";
import type { PollOptions } from "./poll.ts";
import { type Tracker, TrackerError } from "./ports.ts";

export type Trackers = Pick<PollOptions, TrackerKind>;

export function trackerFor(
	trackers: Trackers,
	name: string,
): Tracker | null | undefined {
	const kind = trackerKinds.find((known) => known === name);
	return kind === undefined ? null : trackers[kind];
}

/** Every route answers a failed tracker call with `{ error }` and the tracker's status. */
export function trackerError(error: unknown): Response {
	const message = error instanceof Error ? error.message : "tracker failed";
	const status = error instanceof TrackerError ? error.status : 502;
	return Response.json({ error: message }, { status });
}
