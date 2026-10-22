/**
 * Serves project-flow, workcell and Initial SDI Issues from the tracker
 * responses that `proof/elk-spike/capture.ts` recorded.
 *
 * Usage: bun proof/serve-352.ts DATA_DIR [PORT]
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import { serveRecorded } from "./recorded.ts";

const [dataDir, port] = process.argv.slice(2);
if (dataDir === undefined || dataDir.trim() === "") {
	console.error("usage: bun proof/serve-352.ts DATA_DIR [PORT]");
	process.exit(1);
}

const recorded = JSON.parse(
	await readFile(join(dataDir, "recorded.json"), "utf8"),
) as { url: string; body: string; status: number; text: string }[];

/** A GraphQL request matches on its operation and variables, so page sizes may differ. */
function requestKey(url: string, body: string): string {
	if (body === "") {
		return url;
	}
	const parsed = JSON.parse(body) as { query?: string; variables?: unknown };
	const operation = parsed.query?.match(/^\s*(query|mutation)\s*(\w*)/)?.[2];
	return `${url}\n${operation}\n${JSON.stringify(parsed.variables ?? null)}`;
}

const replies = new Map<string, { status: number; text: string }[]>();
for (const reply of recorded) {
	const key = requestKey(reply.url, reply.body);
	replies.set(key, [...(replies.get(key) ?? []), reply]);
}

const replay: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const body = typeof init?.body === "string" ? init.body : "";
	const queue = replies.get(requestKey(urlOf(input), body)) ?? [];
	const reply = queue.length > 1 ? queue.shift() : queue[0];
	if (reply === undefined) {
		return new Response("not recorded", { status: 404 });
	}
	return new Response(reply.text, { status: reply.status });
};

await serveRecorded({
	prefix: "project-flow-352-",
	port: port ?? process.env.PORT ?? "4752",
	config: {
		tracked: [
			{ tracker: "github", repo: "AbysmalBiscuit/project-flow" },
			{ tracker: "github", repo: "AbysmalBiscuit/workcell" },
			{ tracker: "linear", project: "10ad57098f5b" },
		],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			"*": {
				openView: "graph",
				groupBy: "workstream",
				graphDirection: "left-to-right",
			},
		},
	},
	fetch: replay,
	now: () => new Date("2026-10-22T18:00:00.000Z"),
});
