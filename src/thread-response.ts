import { commentTree } from "./comment-tree.ts";
import type { FetchedThread } from "./domain.ts";
import { ThreadReadTimeout, withThreadLimit } from "./fetch.ts";
import { isMissing } from "./ports.ts";
import { trackerError, type TrackerOf } from "./tracker-route.ts";

export async function threadResponse(
	trackerOf: TrackerOf,
	trackerName: string,
	key: string,
	request: Request,
	threadReadLimitMs: number,
): Promise<Response> {
	const project = new URL(request.url).searchParams.get("project") ?? "";
	const fetchThread = trackerOf(trackerName, project)?.fetchThread;
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
		if (isMissing(error)) {
			return Response.json({ missing: true }, { status: 404 });
		}
		return trackerError(error);
	}
}
