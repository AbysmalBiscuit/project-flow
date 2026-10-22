import { proofStops, proofTheme } from "./lifetime.ts";

const port = process.argv[2] ?? "4337";
const inner = String(Number(port) + 1);
const script = process.argv[3] ?? "proof/serve-graph-flows.ts";
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
