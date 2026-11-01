import { z } from "zod";

import type { Configuration } from "./configuration.ts";
import type { AwaitingPull } from "./domain.ts";
import type { PollOptions } from "./poll.ts";
import type { Forge } from "./ports.ts";
import { refreshProject } from "./project-routes.ts";
import { projectViews } from "./project-views.ts";
import { routeTable } from "./route-table.ts";
import { mergeGateReason, requestChangesCopy } from "./terms.ts";
import { trackerError } from "./tracker-route.ts";

const mergeBody = z.object({ url: z.string().min(1) });

const requestChangesBody = z.object({
	url: z.string().min(1),
	body: z.string(),
});

function refusal(reason: string): Response {
	return Response.json({ error: reason }, { status: 409 });
}

/** The PR at `url` while it waits in Awaiting merge, with its forge. */
function awaitingPullOf(
	url: string,
	options: PollOptions,
	configuration: Configuration,
): { pull: AwaitingPull; forge: Forge | null } | undefined {
	const pull = projectViews(options, configuration)
		.flatMap((view) => view.report.tickets)
		.flatMap((ticket) => ticket.awaitingPulls ?? [])
		.find((item) => item.url === url);
	return pull === undefined
		? undefined
		: { pull, forge: options.backends.forgeOfUrl(url) };
}

/** Send a write to the forge, then poll each project of the PR again before the answer. */
async function writeThenRefresh(
	url: string,
	options: PollOptions,
	configuration: Configuration,
	write: () => Promise<void>,
): Promise<Response> {
	try {
		await write();
	} catch (error) {
		return trackerError(error);
	}
	await Promise.all(
		options.store
			.readTickets()
			.filter((row) => row.pulls.some((item) => item.url === url))
			.map((row) => refreshProject(options, configuration, row)),
	);
	return new Response(null, { status: 204 });
}

async function mergeResponse(
	request: Request,
	options: PollOptions,
	configuration: Configuration,
): Promise<Response> {
	const parsed = mergeBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({ error: "invalid merge" }, { status: 400 });
	}
	const { url } = parsed.data;
	const found = awaitingPullOf(url, options, configuration);
	if (found === undefined) {
		return refusal(mergeGateReason.notAwaiting);
	}
	const { pull, forge } = found;
	if (!pull.mergeGate.open) {
		return refusal(pull.mergeGate.reason);
	}
	const merge = forge?.merge;
	if (merge === undefined) {
		return refusal(mergeGateReason.noCapability);
	}
	return writeThenRefresh(url, options, configuration, () => merge(pull));
}

async function requestChangesResponse(
	request: Request,
	options: PollOptions,
	configuration: Configuration,
): Promise<Response> {
	const parsed = requestChangesBody.safeParse(
		await request.json().catch(() => null),
	);
	if (!parsed.success) {
		return Response.json({ error: "invalid review" }, { status: 400 });
	}
	const { url } = parsed.data;
	const body = parsed.data.body.trim();
	if (body === "") {
		return Response.json({ error: requestChangesCopy.empty }, { status: 400 });
	}
	const found = awaitingPullOf(url, options, configuration);
	if (found === undefined) {
		return refusal(mergeGateReason.notAwaiting);
	}
	const { pull, forge } = found;
	const requestChanges = forge?.requestChanges;
	if (requestChanges === undefined) {
		return refusal(requestChangesCopy.noCapability);
	}
	return writeThenRefresh(url, options, configuration, () =>
		requestChanges(pull, body),
	);
}

/** The routes that act on one PR through its forge. */
export function pullRoutes(
	pollOptions: PollOptions,
	configuration: () => Configuration,
) {
	return routeTable({
		"/api/pulls/merge": {
			POST: (request) => mergeResponse(request, pollOptions, configuration()),
		},
		"/api/pulls/request-changes": {
			POST: (request) =>
				requestChangesResponse(request, pollOptions, configuration()),
		},
	});
}
