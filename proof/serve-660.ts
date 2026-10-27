import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const platform = "acme/platform";

function issue(
	repo: string,
	number: number,
	title: string,
	more: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-18T10:00:00.000Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		comments: 0,
		labels: [],
		assignee: null,
		milestone: null,
		...more,
	};
}

const port = process.argv[2] ?? process.env.PORT ?? "4660";

await serveRecorded({
	prefix: "project-flow-660-",
	port,
	config: {
		pinned: [
			{ tracker: "github", repo: platform },
			{ tracker: "github", repo: widget },
		],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
	},
	fetch: recordedIssues({
		[widget]: [
			issue(widget, 1, "Ship the widget"),
			issue(widget, 8, "Open the gate"),
		],
		[platform]: [
			issue(platform, 11, "Hold the platform", {
				body: `Blocked by: ${widget}#8`,
			}),
			issue(platform, 12, "Draw the platform", {
				parent: {
					number: 1,
					title: "Ship the widget",
					state: "OPEN",
					url: `https://github.com/${widget}/issues/1`,
					repository: { nameWithOwner: widget },
				},
			}),
			issue(platform, 13, "Name the platform"),
		],
	}),
});
