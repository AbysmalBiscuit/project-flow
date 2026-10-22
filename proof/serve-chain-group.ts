import { recordedIssues, serveRecorded } from "./recorded.ts";

const repo = "acme/widget";

function issue(
	number: number,
	title: string,
	blockers: number[] = [],
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body: blockers.map((key) => `Blocked by: ${repo}#${key}`).join("\n"),
		html_url: `https://github.com/${repo}/issues/${number}`,
		comments: 0,
		labels: [{ name: "ready" }],
		assignee: null,
		milestone: null,
		...(number === 97
			? {}
			: {
					parent_issue_url: `https://api.github.com/repos/${repo}/issues/97`,
				}),
	};
}

const titles = [
	"fix(web): paint stored data on the first page load",
	"refactor(web): load page data through TanStack Query",
	"refactor(web): move project and settings pages onto TanStack Query",
	"feat(web): add refresh and last-poll age to the project page",
	"feat: show parent and sub-ticket chips",
	"fix: keep a parent ticket in the group of its sub-tickets",
	"feat(web): show the table hierarchy as expandable rows",
	"refactor(web): lay out the project graph with elkjs",
	"feat(web): frame sub-tickets inside their parent ticket",
	"feat(web): collapse a parent ticket frame on the graph",
	"spike: measure elkjs layered and stress on real projects",
	"fix(web): pin graph controls, escape leaves focus",
	"feat(web): focus the graph on a ticket chain",
	"fix(web): show a matching theme group name once",
	"fix(web): apply project filters in the browser at once",
	"fix(web): keep the graph legend states on one line",
];

const children = titles.map((title, index) => {
	const number = 260 + index;
	const blockers = index % 4 === 0 ? [] : [number - 1];
	return issue(number, title, blockers);
});

const issues: Record<string, Record<string, unknown>[]> = {
	[repo]: [
		issue(97, "feat: redesign Project Flow on the factory state model"),
		...children,
	],
};

const port = process.argv[2] ?? process.env.PORT ?? "4359";

await serveRecorded({
	prefix: "project-flow-chain-group-",
	port,
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: {
				openView: "graph",
				groupBy: process.env.GRAPH_GROUP ?? "theme",
			},
		},
	},
	fetch: recordedIssues(issues),
});
