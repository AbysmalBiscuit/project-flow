import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../../src/domain.ts";
import {
	githubFetch,
	githubRepo,
	issue,
	linearIssues,
	linearSlug,
	otherRepo,
	withApp,
} from "../project-harness.ts";
import { linearFake } from "../support/linear.ts";

async function report(base: string, name: string): Promise<ProjectReport> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}`, base),
	);
	return (await response.json()) as ProjectReport;
}

function urls(report: ProjectReport): Record<string, string | undefined> {
	return Object.fromEntries(
		report.tickets.map((ticket) => [ticket.key, ticket.url]),
	);
}

describe("ticket URLs", () => {
	test("each GitHub ticket, unlinked PR and graph end carries its URL", async () => {
		const gate = issue(8, "Open the gate", { body: "Blocks: #2" });
		const drawn = issue(2, "Draw the nodes", {
			body: `Blocked by: #8\nBlocked by: ${otherRepo}#9`,
		});
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch([drawn, gate]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const shown = await report(base, githubRepo);
				expect(urls(shown)).toEqual({
					[`${githubRepo}#2`]: `https://github.com/${githubRepo}/issues/2`,
					[`${githubRepo}#8`]: `https://github.com/${githubRepo}/issues/8`,
					[`${githubRepo}#40`]: `https://github.com/${githubRepo}/pull/40`,
				});
				const outside = shown.graphLinks
					.flatMap((link) => [link.from, link.to])
					.find((end) => end.key === `${otherRepo}#9`);
				expect(outside?.url).toBe(`https://github.com/${otherRepo}/issues/9`);
			},
		);
	});

	test("each Linear ticket carries its URL", async () => {
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "linear", project: linearSlug },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
				},
				issues: linearIssues,
				github: githubFetch(),
			}),
			{ GITHUB_TOKEN: "recorded-token", LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				expect(urls(await report(base, "Widget launch"))).toEqual({
					"WID-1": "https://linear.app/issue/WID-1",
					"WID-2": "https://linear.app/issue/WID-2",
					"WID-3": "https://linear.app/issue/WID-3",
					"WID-4": "https://linear.app/issue/WID-4",
				});
			},
		);
	});
});
