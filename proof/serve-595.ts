import type { Fetch } from "../src/fetch.ts";
import daemonAbout from "../test/fixtures/factory-daemon.json";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import hubSources from "../test/fixtures/factory-hub-sources.json";
import runEvents from "../test/fixtures/factory-run-events.json";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const hubUrl = "http://hub.test:7777";
const [running41] = hubRuns.runs;
if (running41 === undefined) {
	throw new Error("the hub runs fixture lost a run");
}
const eventsPath = `/runs/${running41.id}/events`;
const liveGapMs = 1_500;

function live(seq: number, event: string, nodePath: string, data: unknown) {
	return {
		run_id: running41?.id,
		seq,
		id: `live-${seq}`,
		recorded_at: new Date(
			Date.parse("2026-10-25T14:21:00Z") + seq * 1000,
		).toISOString(),
		item: { event, node_path: nodePath, data },
	};
}

const liveEvents = [
	live(8, "stage.completed", "plan", { name: "plan", index: 1 }),
	live(9, "checkpoint.saved", "plan", { current_node: "build" }),
	live(10, "stage.started", "build", { name: "build", index: 2 }),
	live(11, "worker.turn_started", "build", { session: "build-2c41" }),
	live(12, "worker.turn_ended", "build", { session: "build-2c41" }),
	live(13, "stage.completed", "build", { name: "build", index: 2 }),
];

/** The box event stream of run 41 as the hub forwards it: the replay, then a live event at a time. */
function eventStream(lastEventId: string | null): Response {
	const all = [...runEvents, ...liveEvents];
	const from =
		lastEventId === null
			? 0
			: all.findIndex((frame) => frame.id === lastEventId) + 1;
	const encoder = new TextEncoder();
	const frame = (item: (typeof all)[number]) =>
		encoder.encode(`id: ${item.id}\ndata: ${JSON.stringify(item)}\n\n`);
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			for (const item of all.slice(from)) {
				if (liveEvents.some((one) => one.id === item.id)) {
					await Bun.sleep(liveGapMs);
				}
				controller.enqueue(frame(item));
			}
			controller.close();
		},
	});
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

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

const answers: Record<string, unknown> = {
	"/daemon": daemonAbout,
	"/sources": hubSources,
	"/runs": hubRuns,
};

const factory: Fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.origin !== hubUrl) {
		return tracker(input, init);
	}
	if (url.pathname === eventsPath) {
		return eventStream(new Headers(init?.headers).get("last-event-id"));
	}
	const answer = answers[url.pathname];
	return answer === undefined
		? new Response("not found", { status: 404 })
		: Response.json(answer);
};

const port = process.argv[2] ?? process.env.PORT ?? "4595";

await serveRecorded({
	prefix: "project-flow-595-",
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
