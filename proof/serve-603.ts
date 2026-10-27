import type { Fetch } from "../src/fetch.ts";
import daemonAbout from "../test/fixtures/factory-daemon.json";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import hubSources from "../test/fixtures/factory-hub-sources.json";
import runArtifact from "../test/fixtures/factory-run-artifact.json";
import runArtifacts from "../test/fixtures/factory-run-artifacts.json";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const widget = "acme/widget";
const hubUrl = "http://hub.test:7777";
const [running41] = hubRuns.runs;
if (running41 === undefined) {
	throw new Error("the hub runs fixture lost a run");
}
const listPath = `/runs/${running41.id}/artifacts`;

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
	[listPath]: runArtifacts,
	[`${listPath}/plan%40v1.a1/response.md`]: runArtifact,
	[`${listPath}/review%40v1.a1/child/verdict%40v1.a1/artifacts/verdict.json`]: {
		...runArtifacts.artifacts[5],
		encoding: "utf-8",
		content: '{"verdict":"ship","findings":[]}',
	},
};

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

const port = process.argv[2] ?? process.env.PORT ?? "4603";

await serveRecorded({
	prefix: "project-flow-603-",
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
