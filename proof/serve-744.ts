import type { Fetch } from "../src/fetch.ts";
import daemonAbout from "../test/fixtures/factory-daemon.json";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import hubSources from "../test/fixtures/factory-hub-sources.json";
import runContext from "../test/fixtures/factory-run-context.json";
import runGraph from "../test/fixtures/factory-run-graph.json";
import runQuestions from "../test/fixtures/factory-run-questions.json";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const hubUrl = "http://hub.test:7777";
const [blocked41] = hubRuns.runs;
const [question] = runQuestions.questions;
if (blocked41 === undefined || question === undefined) {
	throw new Error("the hub fixtures lost a run or a question");
}
const run = `/runs/${blocked41.id}`;
const reason = `question ${question.id} of run ${blocked41.id} is already answered`;

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

const answers: Record<string, () => unknown> = {
	"/daemon": () => daemonAbout,
	"/sources": () => hubSources,
	"/runs": () => ({
		runs: [
			{ ...blocked41, status: { kind: "blocked", reason: null } },
			...hubRuns.runs.slice(1),
		],
	}),
	[`${run}/graph`]: () => runGraph,
	[`${run}/checkpoint`]: () => ({
		current_node: "implement",
		completed_nodes: ["start", "inputs"],
		node_retries: {},
		visits: { start: 1, inputs: 1, implement: 1 },
		status: "running",
		context_values: runContext,
	}),
	[`${run}/questions`]: () => runQuestions,
};

/** The hub answers 409 to every answer post, as to an answered question. */
const factory: Fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.origin !== hubUrl) {
		return tracker(input, init);
	}
	if (url.pathname === `${run}/questions/${question.id}/answer`) {
		return Response.json({ error: reason }, { status: 409 });
	}
	const answer = answers[url.pathname];
	return answer === undefined
		? new Response("not found", { status: 404 })
		: Response.json(answer());
};

const port = process.argv[2] ?? process.env.PORT ?? "4744";

await serveRecorded({
	prefix: "project-flow-744-",
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
