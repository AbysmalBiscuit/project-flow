import type { Fetch } from "../src/fetch.ts";
import daemonAbout from "../test/fixtures/factory-daemon.json";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import hubSources from "../test/fixtures/factory-hub-sources.json";
import steerDelivered from "../test/fixtures/factory-steer-delivered.json";
import { EventFeed } from "../test/support/factory.ts";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const hubUrl = "http://hub.test:7777";
const [blocked41] = hubRuns.runs;
if (blocked41 === undefined) {
	throw new Error("the hub fixtures lost a run");
}
const run = `/runs/${blocked41.id}`;

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

const asks = {
	questions: [
		{
			id: 9,
			node_path: "review/senior_question",
			text: "The review found two gaps.\n\n**Severity:** major\n\n- `src/token.ts` has no test for the `read:org` check\n- the scope error names no fix\n\nShould the run add the test and the error text?\n\n<script>alert(1)</script>",
			answer: null,
		},
	],
	answered: [
		{
			id: 7,
			node_path: "implement/senior_question",
			text: "This waits on Lev: the change needs the `read:org` scope on the factory token. Should the run add the scope, or drop the org check?",
			answer: "Add the **scope**, and keep the org check.",
			sender: "lev",
			answered_at: "2026-10-25T14:05:00+00:00",
		},
	],
};

const feed = new EventFeed();

const answers: Record<string, () => unknown> = {
	"/daemon": () => daemonAbout,
	"/sources": () => hubSources,
	"/runs": () => ({
		runs: [
			{ ...blocked41, status: { kind: "blocked", reason: null } },
			...hubRuns.runs.slice(1),
		],
	}),
	[`${run}/questions`]: () => asks,
};

const factory: Fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.origin !== hubUrl) {
		return tracker(input, init);
	}
	if (url.pathname === "/events") {
		return feed.answer(init?.signal);
	}
	const answer = answers[url.pathname];
	return answer === undefined
		? new Response("not found", { status: 404 })
		: Response.json(answer());
};

void feed.connected(1).then(() =>
	feed.send({
		...steerDelivered,
		item: {
			...steerDelivered.item,
			data: {
				...steerDelivered.item.data,
				text: "Use the **v2** API, not `v1`.",
			},
		},
	}),
);

const port = process.argv[2] ?? process.env.PORT ?? "4797";

await serveRecorded({
	prefix: "project-flow-797-",
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
