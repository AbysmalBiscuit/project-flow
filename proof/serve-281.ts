import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import {
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const repo = "acme/widget";
const fixtureDir = join(import.meta.dir, "../test/fixtures");

async function fixture(name: string): Promise<Record<string, unknown>> {
	const parsed = JSON.parse(await readFile(join(fixtureDir, name), "utf8"));
	if (Array.isArray(parsed)) {
		const first = parsed[0];
		if (first !== null && typeof first === "object") {
			return first as Record<string, unknown>;
		}
	}
	if (parsed !== null && typeof parsed === "object") {
		return parsed as Record<string, unknown>;
	}
	throw new Error(`recorded ${name} has no object`);
}

const issue = await fixture("github-issues.json");
const pull = await fixture("github-open-pulls.json");

const recordedIssue = {
	...issue,
	state: "closed",
	state_reason: "completed",
	closed_at: "2026-10-21T12:00:00Z",
	updated_at: "2026-10-21T12:00:00Z",
	html_url: `https://github.com/${repo}/issues/205`,
};

const recordedPull = {
	...pull,
	state: "closed",
	closed_at: "2026-10-21T11:52:35Z",
	merged_at: "2026-10-21T11:52:35Z",
	updated_at: "2026-10-21T11:52:35Z",
	html_url: `https://github.com/${repo}/pull/206`,
};

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	const linear = emptyLinear(url);
	if (linear !== null) {
		return linear;
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page([recordedIssue]);
	}
	if (url === `https://api.github.com/repos/${repo}/pulls/206`) {
		return Response.json(recordedPull);
	}
	if (emptyLists(url) || url.includes("/pulls?")) {
		return page(url.includes("state=closed") ? [recordedPull] : []);
	}
	if (url === "https://api.github.com/graphql") {
		return (
			repoReadFromLists(
				input,
				init,
				{ [repo]: [recordedIssue] },
				{ [repo]: [recordedPull] },
			) ?? Response.json({ data: {} })
		);
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4281";

await serveRecorded({
	prefix: "project-flow-281-",
	port,
	now: () => new Date("2026-10-22T00:00:00.000Z"),
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: { openView: "board", groupBy: "none" },
		},
	},
	fetch: recorded,
});
