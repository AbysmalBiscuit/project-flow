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

const loopbackNames = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Tells if a request authority names this server. A rebound domain makes a
 * hostile page same-origin with the server, so its Origin alone proves nothing.
 * Only the bound address and the loopback names, which no DNS answer changes,
 * pass.
 */
function namesThisServer(authority: string, server: URL): boolean {
	return [
		server.host,
		...loopbackNames.map((name) => {
			const alias = new URL(server);
			alias.hostname = name;
			return alias.host;
		}),
	].includes(authority);
}

/**
 * Refuses a write that a page on another site can send. A browser adds the
 * page's Origin to a cross-site request, and it sends JSON from another site
 * only after a CORS preflight that this server never answers.
 */
function crossSiteRefusal(request: Request, server: URL): Response | null {
	const target = new URL(request.url);
	const origin = request.headers.get("origin");
	if (
		!namesThisServer(target.host, server) ||
		(origin !== null && origin !== target.origin)
	) {
		return Response.json({ error: "cross-site request" }, { status: 403 });
	}
	const type = request.headers.get("content-type") ?? "";
	if (!type.startsWith("application/json")) {
		return Response.json({ error: "JSON body required" }, { status: 415 });
	}
	return null;
}

async function mergeResponse(
	request: Request,
	options: PollOptions,
	configuration: Configuration,
	server: URL,
): Promise<Response> {
	const crossSite = crossSiteRefusal(request, server);
	if (crossSite !== null) {
		return crossSite;
	}
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
	serverUrl: () => URL,
) {
	return routeTable({
		"/api/pulls/merge": {
			POST: (request) =>
				mergeResponse(request, pollOptions, configuration(), serverUrl()),
		},
	});
}
