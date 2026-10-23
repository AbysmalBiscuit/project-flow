import { recordedIssues, serveRecorded } from "./recorded.ts";

const repos = ["acme/alpha", "acme/beta"];

function issue(repo: string, number: number): Record<string, unknown> {
	return {
		number,
		title: `${repo} ticket ${number}`,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-10-18T12:00:00.000Z",
		body: "",
		labels: [],
	};
}

await serveRecorded({
	prefix: "project-flow-397-",
	port: process.argv[2] ?? process.env.PORT ?? "4398",
	config: {
		pinned: repos.map((repo) => ({ tracker: "github", repo })),
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
		overview: {
			filter: "all",
			sort: "project",
			direction: "asc",
			view: "cards",
		},
	},
	fetch: recordedIssues(
		Object.fromEntries(repos.map((repo) => [repo, [issue(repo, 1)]])),
	),
});
