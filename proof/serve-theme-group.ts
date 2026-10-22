import { recordedIssues, serveRecorded } from "./recorded.ts";

const repo = "acme/widget";

function issue(
	number: number,
	title: string,
	options: { parent?: number; milestone?: string } = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		comments: 0,
		labels: [],
		assignee: null,
		milestone:
			options.milestone === undefined ? null : { title: options.milestone },
		...(options.parent === undefined
			? {}
			: {
					parent_issue_url: `https://api.github.com/repos/${repo}/issues/${options.parent}`,
				}),
	};
}

const issues: Record<string, Record<string, unknown>[]> = {
	[repo]: [
		issue(20, "feat: redesign the board"),
		issue(21, "feat(board): draw the lanes", { parent: 20 }),
		issue(22, "feat(board): draw the cards", { parent: 20 }),
		issue(23, "feat(board): sort the rows", {
			parent: 20,
			milestone: "October",
		}),
	],
};

const port = process.argv[2] ?? process.env.PORT ?? "4342";

await serveRecorded({
	prefix: "project-flow-theme-group-",
	port,
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: { openView: "graph", groupBy: "theme" },
		},
	},
	fetch: recordedIssues(issues),
});
