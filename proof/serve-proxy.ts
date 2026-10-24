import { createServer } from "node:net";

import { proofStops, proofTheme } from "./lifetime.ts";

type ProxyOptions = {
	/** Bundled pages the proxy serves itself, beside the app. */
	pages?: Record<string, Bun.HTMLBundle>;
	/** Markup the proxy adds before `</body>` of each app page. */
	inject?: string;
};

async function injected(response: Response, markup: string) {
	if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
		return response;
	}
	const page = await response.text();
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return new Response(page.replace("</body>", `${markup}</body>`), {
		status: response.status,
		headers,
	});
}

/** Start an app proof script on this port and wait until it answers. */
export async function startApp(
	script: string,
	port: string,
): Promise<Bun.Subprocess> {
	const app = Bun.spawn(["bun", script, port], {
		stdout: "inherit",
		stderr: "inherit",
	});
	for (let tries = 0; tries < 200; tries += 1) {
		const ready = await fetch(`http://127.0.0.1:${port}`).then(
			() => true,
			() => false,
		);
		if (ready) {
			break;
		}
		await Bun.sleep(100);
	}
	return app;
}

/** Find a free localhost port for an app behind a proof proxy. */
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (address === null || typeof address === "string") {
				reject(new Error("proof has no free port"));
				return;
			}
			const chosen = address.port;
			probe.close(() => resolve(chosen));
		});
	});
}

type InjectingOptions = {
	port: number;
	appPort: number;
	/** Markup the proxy adds before `</body>` of each app page. */
	inject: string;
	/** Tries to reach the app, 100 ms apart, while the app starts. */
	attempts: number;
	/** Send the method, headers and body on, not a plain GET. */
	forwardRequest: boolean;
	/** The proof name in the reply when the app never listens. */
	name: string;
};

/** Serve a proxy to an app that another call starts on `appPort`. */
export function serveInjecting(options: InjectingOptions) {
	Bun.serve({
		hostname: "127.0.0.1",
		port: options.port,
		async fetch(request) {
			const url = new URL(request.url);
			const target = `http://127.0.0.1:${String(options.appPort)}${url.pathname}${url.search}`;
			for (let attempt = 0; attempt < options.attempts; attempt += 1) {
				try {
					const response = await fetch(
						target,
						options.forwardRequest
							? {
									method: request.method,
									headers: request.headers,
									body: request.body,
								}
							: {},
					);
					return await injected(response, options.inject);
				} catch {
					await Bun.sleep(100);
				}
			}
			return new Response(`${options.name} app did not listen`, {
				status: 503,
			});
		},
	});
}

/**
 * Serve an app proof script on the next port through a proxy that adds the
 * walk helpers. A route returns its own page, or null to reach the app.
 */
export async function serveProxy(
	port: string,
	script: string,
	route: (url: URL) => Response | null = () => null,
	options: ProxyOptions = {},
): Promise<never> {
	const inner = String(Number(port) + 1);
	const app = await startApp(script, inner);
	const base = `http://127.0.0.1:${inner}`;
	Bun.serve({
		hostname: "127.0.0.1",
		port,
		...(options.pages === undefined
			? {}
			: { development: false, routes: options.pages }),
		async fetch(request) {
			const url = new URL(request.url);
			const own = route(url);
			if (own !== null) {
				return own;
			}
			const target = new URL(`${url.pathname}${url.search}`, base);
			const response = await fetch(
				new Request(target, {
					method: request.method,
					headers: request.headers,
					body: request.body,
				}),
			);
			const themed = await proofTheme(response);
			return options.inject === undefined
				? themed
				: injected(themed, options.inject);
		},
	});
	console.log(`http://127.0.0.1:${port}/`);
	await proofStops();
	app.kill();
	process.exit(0);
}
