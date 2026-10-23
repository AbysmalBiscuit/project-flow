import { expect, test } from "bun:test";
import type { NeedsYouItem, ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import recordedIssues from "./fixtures/github-issues.json";
import recordedPulls from "./fixtures/github-open-pulls.json";
import outsideRelations from "./fixtures/outside-relations.json";
import { withApp } from "./project-harness.ts";
import {
	recordedDiscovery,
	repoReadFromLists,
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = "AbysmalBiscuit/project-flow";

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url === "https://api.github.com/graphql") {
		return (
			repoReadFromLists(
				input,
				init,
				{ [repo]: [...recordedIssues, outsideRelations.githubIssue80] },
				{ [repo]: recordedPulls },
			) ?? Response.json({ data: {} })
		);
	}
	if (url.includes(`/repos/${repo}/`)) {
		return Response.json(url.includes("/check-runs") ? { check_runs: [] } : []);
	}
	return unrecorded(input);
};

test("a Needs you item names the project ticket that carries its PR URL", async () => {
	await withApp(
		JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		recorded,
		{ GITHUB_TOKEN: "recorded-token" },
		async (base) => {
			const items = (await (
				await fetch(new URL("/api/needs-you", base))
			).json()) as NeedsYouItem[];
			const item = items.find((entry) => entry.key === `${repo}#205`);
			expect(item?.project).toBe(repo);
			const report = (await (
				await fetch(
					new URL(
						`/api/projects/${encodeURIComponent(item?.project ?? "")}?view=all`,
						base,
					),
				)
			).json()) as ProjectReport;
			const ticket = report.tickets.find((entry) => entry.key === item?.key);
			expect(ticket?.pullUrl).toBe(
				"https://github.com/AbysmalBiscuit/project-flow/pull/206",
			);
			const bare = report.tickets.find((entry) => entry.key === `${repo}#80`);
			expect(bare).toBeDefined();
			expect(bare?.pullUrl).toBeUndefined();
		},
	);
});
