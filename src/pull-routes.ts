import { z } from "zod";

import type { Configuration } from "./configuration.ts";
import type { PollOptions } from "./poll.ts";
import { refreshProject } from "./project-routes.ts";
import { projectViews } from "./project-views.ts";
import { routeTable } from "./route-table.ts";
import { mergeGateReason } from "./terms.ts";
import { trackerError } from "./tracker-route.ts";

const mergeBody = z.object({ url: z.string().min(1) });

function refusal(reason: string): Response {
	return Response.json({ error: reason }, { status: 409 });
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
	const pull = projectViews(options, configuration)
		.flatMap((view) => view.report.tickets)
		.flatMap((ticket) => ticket.awaitingPulls ?? [])
		.find((item) => item.url === url);
	if (pull === undefined) {
		return refusal(mergeGateReason.notAwaiting);
	}
	if (!pull.mergeGate.open) {
		return refusal(pull.mergeGate.reason);
	}
	const forge = options.backends.forgeOfUrl(url);
	if (forge?.merge === undefined) {
		return refusal(mergeGateReason.noCapability);
	}
	try {
		await forge.merge(pull);
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

/** The routes that act on one PR through its forge. */
export function pullRoutes(
	pollOptions: PollOptions,
	configuration: () => Configuration,
) {
	return routeTable({
		"/api/pulls/merge": {
			POST: (request) => mergeResponse(request, pollOptions, configuration()),
		},
	});
}
