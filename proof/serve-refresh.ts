import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import { emptyLinear, serveRecorded, unrecorded } from "./recorded.ts";

const repo = "acme/widget";
const port = process.argv[2] ?? "4797";
const root = await mkdtemp(join("/var/tmp", "project-flow-207-"));

function issue(updatedAt: string): Record<string, unknown> {
	return {
		number: 1,
		title: "Ship the board",
		state: "open",
		state_reason: null,
		updated_at: updatedAt,
		html_url: `https://github.com/${repo}/issues/1`,
	};
}

let issueReads = 0;
let polls = 0;
const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		issueReads += 1;
		polls += 1;
		if (issueReads > 1) {
			await Bun.sleep(4_000);
			return Response.json([issue("2026-10-19T12:00:00Z")]);
		}
		return Response.json([issue("2026-10-18T12:00:00Z")]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions")
	) {
		return Response.json([]);
	}
	return emptyLinear(url) ?? unrecorded(input);
};

await serveRecorded({
	prefix: "project-flow-207-",
	port,
	dir: root,
	config: {
		theme: "light",
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		viewerLogins: ["lev"],
		pollIntervalSeconds: 3600,
	},
	fetch: recorded,
	now: () => new Date(Date.parse("2026-10-18T12:00:00.000Z") + polls * 60_000),
});
