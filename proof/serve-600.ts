import hubRuns from "../test/fixtures/factory-hub-runs.json";
/**
 * A hub with a failed run on ticket 41 and a blocked run on ticket 42. A resume
 * starts the run again, and a restart adds a new run that names the old run.
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

const issues = [41, 42].map((number) => ticket(number, "2026-10-25T09:00:00Z"));

type Row = Record<string, unknown> & { id: string };

const runs: Row[] = [
	{
		...first,
		status: { kind: "failed", reason: "stage review failed" },
		ended_at: "2026-10-25T14:30:00+00:00",
		restarted_from: null,
	},
	{
		...first,
		id: "20261025-141500-e5f6",
		ticket: "42",
		status: { kind: "blocked", reason: null },
		restarted_from: null,
	},
];

let next = 0;

function startAgain(id: string, restart: boolean): Response {
	const old = runs.find((run) => run.id === id);
	if (old === undefined) {
		return Response.json({ error: `run ${id} not found` }, { status: 404 });
	}
	if (!restart) {
		old.status = { kind: "running", reason: null };
		old.ended_at = null;
		return Response.json(old);
	}
	if ((old.status as { kind: string }).kind === "blocked") {
		old.status = { kind: "failed", reason: "stopped" };
		old.ended_at = "2026-10-25T14:31:00+00:00";
	}
	next += 1;
	const fresh = {
		...old,
		id: `20261025-1435${String(next).padStart(2, "0")}-f7a8`,
		status: { kind: "submitted", reason: null },
		submitted_at: "2026-10-25T14:35:00+00:00",
		started_at: null,
		ended_at: null,
		machine: null,
		restarted_from: id,
	};
	runs.unshift(fresh);
	return Response.json(fresh, { status: 201 });
}

const writes = Object.fromEntries(
	runs.flatMap((run) => [
		[`/runs/${run.id}/resume`, () => startAgain(run.id, false)],
		[`/runs/${run.id}/restart`, () => startAgain(run.id, true)],
	]),
);

await serveRecorded({
	prefix: "project-flow-600-",
	port: process.argv[2]?.trim() || "4600",
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
