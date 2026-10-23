/**
 * Serves acme/widget and acme/gate with Needs you and Blocked tickets, in the overview graph and the project graph.
 * acme/widget#5 carries Needs you, "Run failed" and "Blocked" at once.
 * Usage: bun proof/serve-449.ts [PORT]
 */
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const gate = "acme/gate";

function issue(
	repo: string,
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		updated_at: "2026-10-01T00:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		labels: [{ name: "ready" }],
		assignee: null,
		...fields,
	};
}

const asksLev = {
	labels: [{ name: "ready" }, { name: "needs-human" }],
	assignee: { login: "lev" },
};

const stalledRun = {
	commentRows: [
		{
			id: 1,
			user: { login: "lev" },
			body: "**Workcell progress**\n\n- stage 4: opening the PR",
			created_at: "2026-10-17T00:00:00Z",
		},
	],
};

const port = process.argv[2]?.trim() || "4449";

await serveRecorded({
	prefix: "project-flow-449-",
	port,
	config: {
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: gate },
		],
		checkoutRoots: [],
		pmBot: { [widget]: false, [gate]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		overview: { view: "graph" },
		projectViews: { [widget]: { openView: "graph", groupBy: "none" } },
	},
	fetch: recordedIssues({
		[widget]: [
			issue(widget, 2, "Ship the list", { body: `Blocked by: ${widget}#8` }),
			issue(widget, 3, "Pick the card colour", asksLev),
			issue(widget, 5, "Draft the release notes for the launch", {
				...asksLev,
				...stalledRun,
				body: `Blocked by: ${widget}#8`,
			}),
			issue(widget, 8, "Open the gate"),
		],
		[gate]: [issue(gate, 4, "Hold the platform", asksLev)],
	}),
});
