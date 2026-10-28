import { describe, expect, test } from "bun:test";

import { budgetRead, repos, startCounted } from "./_support.ts";

describe("batched GitHub reads", () => {
	test("a start with 10 tracked repos of 10 open PRs sends at most 35 GitHub requests", async () => {
		const tracked = repos.map((repo) => ({ tracker: "github", repo }));
		const { github, overview, needsYou } = await startCounted(
			JSON.stringify({ tracked }),
			(owner, name) => budgetRead(owner, name),
		);
		expect(github.length).toBeLessThanOrEqual(35);
		expect(github.filter((url) => url.includes("/pulls/")).length).toBe(0);
		expect(github.filter((url) => url.endsWith("/graphql")).length).toBe(21);
		const project = overview.projects.find(
			(item) => item.name === "acme/repo-0",
		);
		expect(
			project?.tickets.find((ticket) => ticket.key === "acme/repo-0#101")
				?.state,
		).toBe("awaitingMerge");
		expect(
			needsYou.find((item) => item.key === "acme/repo-0#101")?.pull?.ci,
		).toBe("passing");
	});

	test("a start with 10 tracked repos of 10 open PRs stays within 35 requests when nested pages are empty", async () => {
		const tracked = repos.map((repo) => ({ tracker: "github", repo }));
		const { github } = await startCounted(
			JSON.stringify({ tracked }),
			(owner, name) => budgetRead(owner, name),
		);
		expect(github.length).toBeLessThanOrEqual(35);
	});
});
