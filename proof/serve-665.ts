import recordedPulls from "../test/fixtures/github-open-pulls.json";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";

function issue(number: number, title: string): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-18T10:00:00.000Z",
		body: "",
		html_url: `https://github.com/${widget}/issues/${number}`,
		comments: 0,
		labels: [],
		assignee: null,
		milestone: null,
	};
}

const [ready, other] = recordedPulls;
if (ready === undefined || other === undefined) {
	throw new Error("recorded open pulls are missing");
}
const asWidget = (pull: typeof ready) => ({
	...pull,
	html_url: `https://github.com/${widget}/pull/${pull.number}`,
});

const port = process.argv[2] ?? process.env.PORT ?? "4665";

await serveRecorded({
	prefix: "project-flow-665-",
	port,
	config: {
		pinned: [{ tracker: "github", repo: widget }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
	},
	fetch: recordedIssues(
		{ [widget]: [issue(1, "Ship the widget"), issue(8, "Open the gate")] },
		{ [widget]: [asWidget(ready), { ...asWidget(other), draft: true }] },
	),
});
