import { proofStops, proofTheme } from "./lifetime.ts";

/**
 * Serve an app proof script on the next port through a proxy that adds the
 * walk helpers. A route returns its own page, or null to reach the app.
 */
export async function serveProxy(
	port: string,
	script: string,
	route: (url: URL) => Response | null = () => null,
): Promise<never> {
	const inner = String(Number(port) + 1);
	const app = Bun.spawn(["bun", script, inner], {
		stdout: "inherit",
		stderr: "inherit",
	});
	const base = `http://127.0.0.1:${inner}`;
	for (let tries = 0; tries < 200; tries += 1) {
		const ready = await fetch(base).then(
			() => true,
			() => false,
		);
		if (ready) {
			break;
		}
		await Bun.sleep(100);
	}
	Bun.serve({
		hostname: "127.0.0.1",
		port,
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
			return proofTheme(response);
		},
	});
	console.log(`http://127.0.0.1:${port}/`);
	await proofStops();
	app.kill();
	process.exit(0);
}
