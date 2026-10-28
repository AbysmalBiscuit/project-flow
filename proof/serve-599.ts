import type { Fetch } from "../src/fetch.ts";
import daemonAbout from "../test/fixtures/factory-daemon.json";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import hubSources from "../test/fixtures/factory-hub-sources.json";
import runContext from "../test/fixtures/factory-run-context.json";
import runGraph from "../test/fixtures/factory-run-graph.json";
import stageTranscript from "../test/fixtures/factory-stage-transcript.json";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const hubUrl = "http://hub.test:7777";
const [running41] = hubRuns.runs;
if (running41 === undefined) {
	throw new Error("the hub runs fixture lost a run");
}
const runId = running41.id;
const run = `/runs/${runId}`;

/**
 * `blocked` stops the run on a failed stage, and `failed` ends it there.
 * `moves` runs it, and the hub event feed starts `join` after `MOVE_AFTER_MS`.
 * The checkpoint leaves `conceptual/review` only `checkpointLagMs` later, as
 * from a slow box. Any other mode runs it.
 */
const mode = process.env.PROOF_MODE ?? "running";
const running = mode === "running" || mode === "moves";
const moveAfterMs = Number(process.env.MOVE_AFTER_MS ?? "25000");
const checkpointLagMs = 15000;
const runs = {
	runs: [
		{
			...running41,
			status: { kind: running ? "running" : mode, reason: null },
		},
		...hubRuns.runs.slice(1),
	],
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

const implementEntries = [
	{
		id: 1,
		visit: 1,
		attempt: 1,
		stage: "implement@v1.a1",
		kind: "message",
		recorded_at: "2026-10-25T14:02:00+00:00",
		text: "I read the handoff, then I write the failing test first.",
	},
	{
		id: 2,
		visit: 1,
		attempt: 1,
		stage: "implement@v1.a1",
		kind: "tool_call",
		recorded_at: "2026-10-25T14:02:30+00:00",
		name: "Write",
		input: '{"file_path": "test/factory/stage.test.ts"}',
		truncated: false,
	},
];

/** The live stage adds one entry every few seconds, as an agent at work does. */
const started = Date.now();
const liveEntries = () => {
	const added = Math.floor((Date.now() - started) / 4000);
	return [
		...stageTranscript.entries,
		...Array.from({ length: added }, (_, index) => ({
			id: 9 + index,
			visit: 1,
			attempt: 1,
			stage: "conceptual@v1.a1/child/review@v1.a1",
			kind: "message",
			recorded_at: new Date(started + (index + 1) * 4000).toISOString(),
			text: `Review note ${index + 1}: the route reads the hub first.`,
		})),
	];
};

function page(entries: { id: number }[], url: URL) {
	const after = Number(url.searchParams.get("after") ?? "0");
	const found = entries.filter((entry) => entry.id > after);
	return { entries: found, next: found.at(-1)?.id ?? after };
}

const moved = () =>
	mode === "moves" && Date.now() - started >= moveAfterMs + checkpointLagMs;

/** The hub event feed of the `moves` mode: one `stage.started` frame for `join`. */
function events(): Response {
	const frame = {
		run_id: runId,
		recorded_at: new Date().toISOString(),
		item: { event: "stage.started", node_path: "join", data: {} },
	};
	const body = new ReadableStream<Uint8Array>({
		start: (controller) => {
			setTimeout(
				() =>
					controller.enqueue(
						new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`),
					),
				Math.max(0, started + moveAfterMs - Date.now()),
			);
		},
	});
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

const answers: Record<string, (url: URL) => unknown> = {
	"/daemon": () => daemonAbout,
	"/sources": () => hubSources,
	"/runs": () => runs,
	[`${run}/graph`]: () => runGraph,
	[`${run}/checkpoint`]: () =>
		moved()
			? {
					current_node: "join",
					completed_nodes: [
						"start",
						"inputs",
						"implement",
						"push",
						"conceptual",
					],
					node_retries: {},
					visits: {
						start: 1,
						inputs: 1,
						implement: 1,
						push: 1,
						conceptual: 1,
						join: 1,
					},
					status: "running",
					context_values: runContext,
				}
			: {
					current_node: "review",
					stack: [{ node: "conceptual" }],
					completed_nodes: ["start", "inputs", "implement", "push", "start"],
					node_retries: {},
					visits: { start: 1, inputs: 1, implement: 1, push: 1, conceptual: 1 },
					status: running ? "running" : "fail",
					context_values: runContext,
				},
	[`${run}/workers`]: () => ({
		workers: {
			"conceptual/review": {
				current_tool: "Bash",
				last_message: "",
				turn: "running",
			},
		},
	}),
	[`${run}/stages/implement/transcript`]: (url) => page(implementEntries, url),
	[`${run}/stages/conceptual/review/transcript`]: (url) =>
		page(liveEntries(), url),
	[`${run}/steer`]: () => ({ id: 1, run_id: running41.id, sender: "lev" }),
};

const factory: Fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.origin !== hubUrl) {
		return tracker(input, init);
	}
	if (init?.method === "POST") {
		console.error(`factory POST ${url.pathname} ${String(init.body)}`);
	}
	if (mode === "moves" && url.pathname === "/events") {
		return events();
	}
	const answer = answers[url.pathname];
	return answer === undefined
		? new Response("not found", { status: 404 })
		: Response.json(answer(url));
};

const port = process.argv[2] ?? process.env.PORT ?? "4599";

await serveRecorded({
	prefix: "project-flow-599-",
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
