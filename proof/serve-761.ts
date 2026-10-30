import type { Fetch } from "../src/fetch.ts";
import daemonAbout from "../test/fixtures/factory-daemon.json";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import hubSources from "../test/fixtures/factory-hub-sources.json";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const hubUrl = "http://hub.test:7777";

function ticket(number: number, title: string, assignee: string | null) {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-25T09:00:00.000Z",
		body: "",
		html_url: `https://github.com/${widget}/issues/${number}`,
		comments: 0,
		labels: [],
		assignee: assignee === null ? null : { login: assignee },
		milestone: null,
	};
}

const tracker = recordedIssues({
	[widget]: [
		ticket(39, "Parse the widget feed", "lev"),
		ticket(40, "Cache the widget list", null),
		ticket(41, "Widget search box", "lev"),
		ticket(42, "Widget export button", "sam"),
		ticket(43, "Widget docs page", null),
	],
});

const answers: Record<string, () => unknown> = {
	"/daemon": () => daemonAbout,
	"/sources": () => hubSources,
	"/runs": () => hubRuns,
};

const factory: Fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.origin !== hubUrl) {
		return tracker(input, init);
	}
	const answer = answers[url.pathname];
	return answer === undefined
		? new Response("not found", { status: 404 })
		: Response.json(answer());
};

const port = process.argv[2] ?? process.env.PORT ?? "4761";

await serveRecorded({
	prefix: "project-flow-761-",
	port,
	config: {
		pinned: [{ tracker: "github", repo: widget }],
		factories: [{ name: "work hub", url: hubUrl }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
	},
	fetch: factory,
	now: () => new Date("2026-10-25T14:20:00.000Z"),
});
