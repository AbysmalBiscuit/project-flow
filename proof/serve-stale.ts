import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src/app.ts";
import type { Fetch } from "../src/fetch.ts";

const root = await mkdtemp(join(tmpdir(), "project-flow-stale-"));
const databasePath = join(root, "project-flow.sqlite");
let polls = 0;

const recordedThenFailing: Fetch = async (input) => {
	const url = typeof input === "string" ? input : input.toString();
	if (url === "https://api.github.com/user") {
		return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
	}
	if (url.includes("/issues?")) {
		polls += 1;
		if (polls === 1) {
			return new Response(
				JSON.stringify([
					{
						number: 1,
						title: "Ship the card",
						state: "open",
						state_reason: null,
						updated_at: "2026-04-01T00:00:00Z",
					},
				]),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return new Response("recorded failure", { status: 500 });
	}
	return new Response("not recorded", { status: 404 });
};

const running = await start({
	configPath: process.argv[2] ?? "",
	token: "recorded-token",
	linearKey: null,
	fetch: recordedThenFailing,
	databasePath,
	hostname: "127.0.0.1",
	port: 4174,
	now: () => new Date("2026-04-01T12:00:00.000Z"),
});
await fetch(new URL("/api/refresh", running.url), { method: "POST" });
await new Promise<void>((resolve) => {
	process.once("SIGINT", () => resolve());
	process.once("SIGTERM", () => resolve());
});
await running.stop();
