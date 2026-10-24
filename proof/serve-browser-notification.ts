import { join } from "node:path";

import { proofStops } from "./lifetime.ts";
import { releaseLinearAsk, runLinearProof } from "./serve-inbox.ts";

const port = process.argv[2] ?? "4176";
const rootDir = process.argv[3] ?? "/var/tmp";
const holdAsk = process.argv[4] === "hold";
const built = await Bun.build({
	entrypoints: [join(import.meta.dir, "notification-stub.ts")],
	target: "browser",
});
const stubSource = await built.outputs[0]?.text();
if (stubSource === undefined) {
	throw new Error("notification stub did not build");
}
const originalFetch = globalThis.fetch.bind(globalThis);
let upstreamOrigin = "";
let streamOpen = false;
let permissionGranted = false;
let proxy: ReturnType<typeof Bun.serve> | undefined;
let armTimer: ReturnType<typeof setTimeout> | undefined;

void proofStops();
await runLinearProof(
	"0",
	rootDir,
	(line) => {
		upstreamOrigin = new URL(line).origin;
		startProxy();
		if (holdAsk) {
			return;
		}
		const origin = upstreamOrigin;
		const arm = async () => {
			if (!streamOpen || !permissionGranted) {
				armTimer = setTimeout(() => {
					void arm();
				}, 200);
				return;
			}
			releaseLinearAsk();
			await originalFetch(new URL("/api/refresh", origin), { method: "POST" });
		};
		armTimer = setTimeout(() => {
			void arm();
		}, 200);
	},
	async () => {
		clearTimeout(armTimer);
		await proxy?.stop(true);
	},
);

function startProxy(): void {
	proxy = Bun.serve({
		hostname: "127.0.0.1",
		port: Number(port),
		async fetch(request) {
			const url = new URL(request.url);
			if (
				url.pathname === "/api/proof/stream-open" &&
				request.method === "POST"
			) {
				streamOpen = true;
				return new Response(null, { status: 204 });
			}
			if (
				url.pathname === "/api/proof/permission" &&
				request.method === "POST"
			) {
				permissionGranted = true;
				return new Response(null, { status: 204 });
			}
			const upstream = new URL(url.pathname + url.search, upstreamOrigin);
			const init: RequestInit = {
				method: request.method,
				headers: request.headers,
			};
			if (request.method !== "GET" && request.method !== "HEAD") {
				init.body = request.body;
			}
			const response = await originalFetch(upstream, init);
			const type = response.headers.get("content-type") ?? "";
			if (
				!type.includes("text/html") ||
				url.searchParams.get("proof") !== "notification"
			) {
				return response;
			}
			const html = await response.text();
			const withStub = html.includes("<head>")
				? html.replace("<head>", `<head><script>${stubSource}</script>`)
				: `<script>${stubSource}</script>${html}`;
			return new Response(withStub, {
				status: response.status,
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	});
	console.log(proxy.url.href);
}
