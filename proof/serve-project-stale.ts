import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { start } from "../src/app.ts";
import type { Fetch } from "../src/fetch.ts";
import { answerRecordedRepoRead } from "../test/recorded-read.ts";
import { recordedViewer, urlOf } from "../test/support.ts";
import { proofStops } from "./lifetime.ts";

const root = await mkdtemp(join(tmpdir(), "project-flow-project-stale-"));
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	JSON.stringify({
		pinned: [
			{ tracker: "github", repo: "acme/widget" },
			{ tracker: "github", repo: "acme/other" },
		],
		pollIntervalSeconds: 3600,
	}),
);

const ticket = (repo: string) => ({
	number: 1,
	title: "Ship the card",
	state: "open",
	state_reason: null,
	updated_at: "2026-04-01T00:00:00Z",
	html_url: `https://github.com/${repo}/issues/1`,
});

let otherPolls = 0;
const recorded: Fetch = async (input, init) => {
	const known = recordedViewer(input, init);
	if (known !== null) {
		return known;
	}
	const url = urlOf(input);
	if (url.includes("/repos/acme/other/issues?")) {
		otherPolls += 1;
		if (otherPolls > 1) {
			return new Response("recorded failure", { status: 500 });
		}
		return new Response(JSON.stringify([ticket("acme/other")]), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (url.includes("/repos/acme/widget/issues?")) {
		return new Response(JSON.stringify([ticket("acme/widget")]), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (url.includes("/pulls?") || url.includes("/branches?")) {
		return new Response("[]", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	return new Response("not recorded", { status: 404 });
};

const running = await start({
	configPath,
	token: "recorded-token",
	linearKey: null,
	fetch: answerRecordedRepoRead(recorded),
	databasePath: join(root, "project-flow.sqlite"),
	hostname: "127.0.0.1",
	port: 4175,
	now: () => new Date("2026-04-01T12:00:00.000Z"),
});
const refresh = await fetch(new URL("/api/refresh", running.url), {
	method: "POST",
});
if (!refresh.ok && refresh.status !== 204) {
	throw new Error(`refresh failed (HTTP ${refresh.status})`);
}
await proofStops();
await running.stop();
