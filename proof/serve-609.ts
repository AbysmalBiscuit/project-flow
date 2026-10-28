import hubRuns from "../test/fixtures/factory-hub-runs.json";
/**
 * A hub with ended runs on tickets 39, 40 and 41 and a running run on ticket 42.
 * A delete drops a run, and an archive sets its `archived_at`.
 */
import { factoryFetch, hub, hubUrl } from "../test/support/factory.ts";
import { urlOf } from "../test/support/fetch.ts";
import {
	issuesResponse,
	page,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	ticket,
	unrecorded,
} from "../test/support/github.ts";
import { serveRecorded } from "./recorded.ts";

const started = Date.now();
const [first] = hubRuns.runs;
if (first === undefined) {
	throw new Error("the hub runs fixture lost a run");
}

const issues = [39, 40, 41, 42].map((number) =>
	ticket(number, "2026-10-25T09:00:00Z"),
);

type Row = Record<string, unknown> & { id: string };

const ended = (
	number: number,
	hour: number,
	kind: string,
	reason: string | null,
): Row => ({
	...first,
	id: `20261025-${hour}0000-a${number}`,
	ticket: String(number),
	status: { kind, reason },
	submitted_at: `2026-10-25T${hour}:00:00+00:00`,
	started_at: `2026-10-25T${hour}:00:10+00:00`,
	ended_at: `2026-10-25T${hour}:40:00+00:00`,
	archived_at: null,
});

let runs: Row[] = [
	{ ...first, ticket: "42", archived_at: null },
	ended(41, 13, "failed", "stage review failed"),
	ended(40, 12, "succeeded", null),
	ended(39, 11, "failed", "stopped"),
];

const writes = Object.fromEntries(
	runs.flatMap((run) => [
		[
			`/runs/${run.id}/delete`,
			() => {
				runs = runs.filter((item) => item.id !== run.id);
				return Response.json(run);
			},
		],
		[
			`/runs/${run.id}/archive`,
			() => {
				run.archived_at = "2026-10-25T14:45:00+00:00";
				return Response.json(run);
			},
		],
	]),
);

await serveRecorded({
	prefix: "project-flow-609-",
	port: process.argv[2]?.trim() || "4609",
	config: {
		pinned: [{ tracker: "github", repo }],
		factories: [{ name: "work hub", url: hubUrl }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		theme: "light",
	},
	fetch: factoryFetch(
		{
			[hubUrl]: {
				...hub,
				"/runs": () => ({ runs }),
				...writes,
			},
		},
		[],
		async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			return (
				recordedDiscovery(input, init) ??
				issuesResponse(input, init, issues) ??
				recordedOrEmpty(url) ??
				(url.includes("/dependencies/") ? page([]) : unrecorded(input, init))
			);
		},
	),
	now: () =>
		new Date(Date.parse("2026-10-25T14:40:00.000Z") + Date.now() - started),
});
