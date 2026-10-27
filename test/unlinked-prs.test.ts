import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../src/domain.ts";
import recordedPulls from "./fixtures/github-open-pulls.json";
import { githubFetch, githubRepo, withApp } from "./project-harness.ts";

const [ready, other] = recordedPulls;
if (ready === undefined || other === undefined) {
	throw new Error("recorded open pulls are missing");
}
const asWidget = (pull: typeof ready) => ({
	...pull,
	html_url: `https://github.com/${githubRepo}/pull/${pull.number}`,
});

async function reportOf(base: string, query = ""): Promise<ProjectReport> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(githubRepo)}${query}`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectReport;
}

describe("GET /api/projects/:name unlinked PRs", () => {
	test("an unlinked PR is a card in the Unlinked PRs group in the lane of its review state", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				projectViews: {
					[githubRepo]: { shownLanes: ["Backlog", "In progress", "In review"] },
				},
			}),
			githubFetch([], [], undefined, [
				asWidget(ready),
				{ ...asWidget(other), draft: true },
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const full = await reportOf(base, "?view=all");
				expect(full).toMatchObject({
					tickets: [
						{
							key: `${githubRepo}#${ready.number}`,
							title: ready.title,
							state: "awaitingMerge",
							lane: "Awaiting merge",
							pullUrl: `https://github.com/${githubRepo}/pull/${ready.number}`,
							unlinkedPr: true,
							workstream: "Unlinked PRs",
							themeGroup: "Unlinked PRs",
						},
						{
							key: `${githubRepo}#${other.number}`,
							state: "inProgress",
							lane: "In progress",
							unlinkedPr: true,
							workstream: "Unlinked PRs",
						},
					],
				});
				expect(
					full.sections.find((section) => section.id === "inFlight"),
				).toMatchObject({
					items: [
						{ key: `${githubRepo}#${ready.number}`, state: "awaitingMerge" },
						{ key: `${githubRepo}#${other.number}`, state: "inProgress" },
					],
				});
				const filtered = await reportOf(base);
				expect(filtered.tickets.map((item) => item.key)).toEqual([
					`${githubRepo}#${other.number}`,
				]);
			},
		);
	});
});
