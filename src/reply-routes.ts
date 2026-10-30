import { z } from "zod";

import type { Configuration } from "./configuration.ts";
import { type PostedReply, trackerKinds } from "./domain.ts";
import { defaultThreadReadLimitMs } from "./fetch.ts";
import { type PollOptions, runningOverview } from "./poll.ts";
import type { Notifier } from "./ports.ts";
import { recordedReply, replyRequest } from "./replies.ts";
import { routeTable } from "./route-table.ts";
import type { staleReads } from "./stale-reads.ts";
import { threadResponse } from "./thread-response.ts";
import { trackerError, trackerFor, type Trackers } from "./tracker-route.ts";

const replyBody = z.object({
	tracker: z.enum(trackerKinds),
	project: z.string().trim().min(1),
	key: z.string().trim().min(1),
	body: z.string().optional(),
	option: z.number().int().positive().optional(),
	parentId: z.string().optional(),
	kind: z.enum(["comment", "review"]).optional(),
});

async function replyResponse(
	trackers: Trackers,
	request: Request,
	options: PollOptions,
	notifier: Notifier,
	configuration: Configuration,
): Promise<Response> {
	const parsed = replyBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({ error: "invalid reply" }, { status: 400 });
	}
	const tracker = trackerFor(trackers, parsed.data.tracker);
	if (tracker?.postReply === undefined) {
		return Response.json({ error: "tracker unavailable" }, { status: 404 });
	}
	const drafted = replyRequest(
		options.store.readTickets(),
		parsed.data,
		configuration.pmBot,
	);
	if ("error" in drafted) {
		return Response.json({ error: drafted.error }, { status: 400 });
	}
	const { reply } = drafted;
	try {
		const created: PostedReply = await tracker.postReply(reply);
		const recorded = recordedReply(options.store.readTickets(), reply, created);
		if (recorded !== undefined) {
			options.store.mergeTickets([recorded]);
		}
		notifier.publish({
			overview: runningOverview(options, configuration),
			notifications: [],
		});
		return Response.json(created, { status: 201 });
	} catch (error) {
		return trackerError(error);
	}
}

export type ReplyRouteOptions = {
	trackers: Trackers;
	pollOptions: PollOptions;
	notifier: Notifier;
	configuration: () => Configuration;
	staleRead: ReturnType<typeof staleReads>;
	readKey: (request: Request) => string;
	threadReadLimitMs: number | undefined;
};

/** The routes that read the thread of a ticket and post a reply to it. */
export function replyRoutes({
	trackers,
	pollOptions,
	notifier,
	configuration,
	staleRead,
	readKey,
	threadReadLimitMs,
}: ReplyRouteOptions) {
	return routeTable({
		"/api/threads/:tracker/:key": {
			GET: (request) =>
				staleRead(readKey(request), () =>
					threadResponse(
						trackers,
						request.params.tracker,
						request.params.key,
						request,
						threadReadLimitMs ?? defaultThreadReadLimitMs,
					),
				),
		},
		"/api/replies": {
			POST: (request) =>
				replyResponse(
					trackers,
					request,
					pollOptions,
					notifier,
					configuration(),
				),
		},
	});
}
