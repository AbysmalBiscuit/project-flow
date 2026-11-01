const loopbackNames = ["localhost", "127.0.0.1", "[::1]"];

const wildcardBinds = new Set(["0.0.0.0", "::", "[::]"]);

const writeMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;

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
 * Tells if a request comes from this server's page on a specific bind. The
 * authority must name the server, and the Origin must match it.
 */
function sameSiteOnBoundAddress(request: Request, server: URL): boolean {
	const target = new URL(request.url);
	const origin = request.headers.get("origin");
	return (
		namesThisServer(target.host, server) &&
		(origin === null || origin === target.origin)
	);
}

/**
 * Tells if a request comes from this server's page on a wildcard bind. The
 * server has no one name there, so the Origin must match the request's `Host`
 * header. A wildcard bind gives up the DNS rebinding defence: a rebound domain
 * sends a matching pair.
 */
function sameSiteOnWildcard(request: Request): boolean {
	const origin = request.headers.get("origin");
	return (
		origin === null || URL.parse(origin)?.host === request.headers.get("host")
	);
}

/**
 * Refuses a write that a page on another site can send. A browser adds the
 * page's Origin to a cross-site request, and it sends JSON from another site
 * only after a CORS preflight that this server never answers. A write with no
 * body has no content type to check, so only its Origin guards it.
 */
function crossSiteRefusal(
	request: Request,
	hostname: string,
	server: URL,
): Response | null {
	const sameSite = wildcardBinds.has(hostname)
		? sameSiteOnWildcard(request)
		: sameSiteOnBoundAddress(request, server);
	if (!sameSite) {
		return Response.json({ error: "cross-site request" }, { status: 403 });
	}
	const type = request.headers.get("content-type") ?? "";
	if (request.body !== null && !type.startsWith("application/json")) {
		return Response.json({ error: "JSON body required" }, { status: 415 });
	}
	return null;
}

/** Puts the cross-site refusal in front of each write method of a route table. */
export function guardWrites<Routes extends Record<string, unknown>>(
	routes: Routes,
	hostname: string,
	server: () => URL,
): Routes {
	const guarded = Object.entries(routes).map(([path, route]) => {
		if (typeof route !== "object" || route === null) {
			return [path, route];
		}
		const methods: Record<string, unknown> = { ...route };
		for (const method of writeMethods) {
			const handler = methods[method];
			if (typeof handler === "function") {
				methods[method] = (...args: [Request, ...unknown[]]) =>
					crossSiteRefusal(args[0], hostname, server()) ?? handler(...args);
			}
		}
		return [
			path,
			writeMethods.some((method) => method in methods) ? methods : route,
		];
	});
	return Object.fromEntries(guarded) as Routes;
}
