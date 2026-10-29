import type { Fetch } from "../src/fetch.ts";
import daemonAbout from "../test/fixtures/factory-daemon.json";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import hubSources from "../test/fixtures/factory-hub-sources.json";
import runQuestions from "../test/fixtures/factory-run-questions.json";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const hubUrl = "http://hub.test:7777";
const [run41] = hubRuns.runs;
if (run41 === undefined) {
	throw new Error("the hub runs fixture lost a run");
}

/** Run 41 is blocked on one open question, so the panel shows an answer box and the steer box. */
const answers: Record<string, unknown> = {
	"/daemon": daemonAbout,
	"/sources": hubSources,
	"/runs": {
		runs: [
			{ ...run41, status: { kind: "blocked", reason: null } },
			...hubRuns.runs.slice(1),
		],
	},
	[`/runs/${run41.id}/questions`]: runQuestions,
};

const tracker = recordedIssues({
	[widget]: [
		{
			number: 41,
			title: "Ticket 41",
			state: "open",
			state_reason: null,
			updated_at: "2026-10-25T09:00:00.000Z",
			body: "",
			html_url: `https://github.com/${widget}/issues/41`,
			comments: 0,
			labels: [],
			assignee: null,
			milestone: null,
		},
	],
});

const factory: Fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.origin !== hubUrl) {
		return tracker(input, init);
	}
	const answer = answers[url.pathname];
	return answer === undefined
		? new Response("not found", { status: 404 })
		: Response.json(answer);
};

await serveRecorded({
	prefix: "project-flow-743-",
	port: process.argv[2] ?? process.env.PORT ?? "4743",
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
