import { expect, test } from "bun:test";

import type { NeedsYouItem, ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import recordedIssues from "./fixtures/github-issues.json";
import recordedPulls from "./fixtures/github-open-pulls.json";
import recordedTeam from "./fixtures/linear-team-states.json";
import outsideRelations from "./fixtures/outside-relations.json";
import { withApp } from "./project-harness.ts";
import {
	linearFake,
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

test("a Linear project ticket carries the URL of its attached PR", async () => {
	const pull = recordedPulls.find((item) => item.number === 206);
	const ticket = {
		...outsideRelations.linearSwe13029,
		id: "swe-13029",
		attachments: {
			nodes: [
				{ url: pull?.html_url, title: pull?.title, sourceType: "github" },
			],
		},
	};
	const linear = linearFake({
		states: recordedTeam.data.team.states.nodes,
		issues: [ticket],
	});
	await withApp(
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" }],
		}),
		async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.linear.app/graphql") {
				return linear(input, init);
			}
			if (url === `https://api.github.com/repos/${repo}/pulls/206`) {
				return Response.json(pull);
			}
			return recorded(input, init);
		},
		{ GITHUB_TOKEN: "recorded-token", LINEAR_API_KEY: "recorded-linear-key" },
		async (base) => {
			const report = (await (
				await fetch(new URL("/api/projects/Widget%20launch?view=all", base))
			).json()) as ProjectReport;
			expect(
				report.tickets.find((entry) => entry.key === "SWE-13029")?.pullUrl,
			).toBe("https://github.com/AbysmalBiscuit/project-flow/pull/206");
		},
	);
});
