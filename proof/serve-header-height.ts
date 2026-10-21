import { spawn } from "node:child_process";
import { proofStops } from "./lifetime.ts";

const port = process.argv[2] ?? "4317";
const inner = process.argv[3] ?? "4318";
const phone = process.argv[4] === "390";
const permissionStub = `<script>
Object.defineProperty(window, "Notification", {
	configurable: true,
	value: {
		permission: "default",
		requestPermission: () => Promise.resolve("default"),
	},
});
</script>`;

const child = spawn("bun", ["proof/serve-controls.ts", inner], {
	stdio: ["ignore", "pipe", "inherit"],
});
const stops = proofStops();
void stops.then(() => {
	child.kill("SIGTERM");
});

let upstream = "";
const ready = new Promise<void>((resolve, reject) => {
	const timer = setTimeout(() => {
		reject(new Error("controls server was not ready"));
	}, 9000);
	child.stdout?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		const line = chunk
			.split("\n")
			.map((item) => item.trim())
			.find((item) => item.startsWith("http://"));
		if (line === undefined) {
			return;
		}
		upstream = line;
		clearTimeout(timer);
		resolve();
	});
	child.on("exit", (code) => {
		clearTimeout(timer);
		reject(new Error(`controls server exited ${code ?? "null"}`));
	});
});

await ready;

Bun.serve({
	hostname: "127.0.0.1",
	port: Number(port),
	async fetch(request) {
		const url = new URL(request.url);
		const target = new URL(url.pathname + url.search, upstream);
		const response = await fetch(target, {
			method: request.method,
			headers: request.headers,
			...(request.method === "GET" || request.method === "HEAD"
				? {}
				: { body: request.body }),
		});
		const type = response.headers.get("content-type") ?? "";
		if (!type.includes("text/html")) {
			return response;
		}
		const html = await response.text();
		const frame = phone
			? "<style>html{width:390px;overflow-x:hidden}@media (min-width:64.01rem){body main{padding-left:1rem!important;padding-right:1rem!important}}</style>"
			: "";
		const withStub = html.includes("<head>")
			? html.replace("<head>", `<head>${permissionStub}${frame}`)
			: `${permissionStub}${frame}${html}`;
		return new Response(withStub, {
			status: response.status,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	},
});

console.log(`http://127.0.0.1:${port}/`);
await stops;
