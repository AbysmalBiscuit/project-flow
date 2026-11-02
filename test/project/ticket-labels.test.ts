import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../../src/domain.ts";
import {
	githubFetch,
	githubRepo,
	issue,
	linearIssues,
	linearSlug,
	withApp,
} from "../project-harness.ts";
import { linearFake } from "../support/linear.ts";

async function readReport(base: string, name: string): Promise<ProjectReport> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectReport;
}

function labelsOf(report: ProjectReport, key: string) {
	const ticket = report.tickets.find((item) => item.key === key);
	expect(ticket).toBeDefined();
	return ticket?.labels;
}

describe("GET /api/projects/:name", () => {
	test("a GitHub ticket carries its tracker labels", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([
				issue(1, "Ship the map", {
					labels: [{ name: "design" }, { name: "good first issue" }],
				}),
				issue(2, "Write the copy"),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await readReport(base, githubRepo);
				expect(labelsOf(report, `${githubRepo}#1`)).toEqual([
					"design",
					"good first issue",
				]);
				expect(labelsOf(report, `${githubRepo}#2`)).toBeUndefined();
			},
		);
	});

	test("a Linear ticket carries its tracker labels", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
				},
				issues: linearIssues.map((item) =>
					item.identifier === "WID-3"
						? { ...item, labels: { nodes: [{ name: "Docs" }, { name: "P2" }] } }
						: item,
				),
			}),
			{ GITHUB_TOKEN: "recorded-token", LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await readReport(base, "Widget launch");
				expect(labelsOf(report, "WID-3")).toEqual(["Docs", "P2"]);
				expect(labelsOf(report, "WID-1")).toEqual(["epic"]);
				expect(labelsOf(report, "WID-4")).toBeUndefined();
			},
		);
	});
});
