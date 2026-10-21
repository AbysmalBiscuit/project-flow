import { commentTree, type FetchedThread } from "./domain.ts";
import { ThreadReadTimeout, withThreadLimit } from "./fetch.ts";
import { TrackerError } from "./github.ts";
import type { Tracker } from "./ports.ts";

type Trackers = { github: Tracker | null; linear: Tracker | null };

function trackerFor(trackers: Trackers, name: string): Tracker | null {
	if (name === "github") {
		return trackers.github;
	}
	if (name === "linear") {
		return trackers.linear;
	}
	return null;
}

function trackerError(error: unknown): Response {
	const message = error instanceof Error ? error.message : "reply failed";
	const status =
		error instanceof Error &&
		"status" in error &&
		typeof error.status === "number"
			? error.status
			: 502;
	return Response.json({ error: message }, { status });
}

export async function threadResponse(
	trackers: Trackers,
	trackerName: string,
	key: string,
	request: Request,
	threadReadLimitMs: number,
): Promise<Response> {
	const tracker = trackerFor(trackers, trackerName);
	const project = new URL(request.url).searchParams.get("project") ?? "";
	const fetchThread = tracker?.fetchThread;
	if (fetchThread === undefined || project.trim() === "") {
		return Response.json({ missing: true }, { status: 404 });
	}
	try {
		const thread: FetchedThread | null = await withThreadLimit(
			(signal) => fetchThread(project, key.trim(), signal),
			threadReadLimitMs,
		);
		if (thread === null) {
			return Response.json({ missing: true }, { status: 404 });
		}
		return Response.json({
			...thread,
			comments: commentTree(thread.comments),
		});
	} catch (error) {
		if (error instanceof ThreadReadTimeout) {
			return Response.json({ error: error.message }, { status: 504 });
		}
		if (
			error instanceof TrackerError &&
			(error.status === 404 || error.status === 410)
		) {
			return Response.json({ missing: true }, { status: 404 });
		}
		return trackerError(error);
	}
}
