import { issue } from "../test/project-harness.ts";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const platform = "acme/platform";

function ticket(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return issue(number, title, {
		assignee: { login: "ada" },
		milestone: { title: "October" },
		...fields,
	});
}

function under(parent: number): { parent_issue_url: string } {
	return {
		parent_issue_url: `https://api.github.com/repos/${widget}/issues/${parent}`,
	};
}

const issues = {
	[widget]: [
		ticket(1, "Ship the map"),
		ticket(2, "Draw the nodes", under(1)),
		ticket(3, "Draw the edges", under(1)),
		ticket(4, "Colour the nodes", under(2)),
		ticket(5, "Wire the platform hook", {
			parent: {
				number: 9,
				title: "Platform gate",
				state: "OPEN",
				url: `https://github.com/${platform}/issues/9`,
				repository: { nameWithOwner: platform },
			},
		}),
		ticket(6, "Write the notes"),
	],
};

await serveRecorded({
	prefix: "project-flow-351-",
	port: process.argv[2] ?? "4351",
	config: {
		pinned: [{ tracker: "github", repo: widget }],
		checkoutRoots: [],
		pmBot: { [widget]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[widget]: {
				openView: "graph",
				groupBy: process.argv[3] ?? "none",
				graphDirection: "left-to-right",
			},
		},
	},
	fetch: recordedIssues(issues),
});
