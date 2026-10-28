import hubRuns from "../test/fixtures/factory-hub-runs.json";
/**
 * A project with a blocked run on ticket 43, a running run on ticket 41 and a failed run
 * on ticket 39. A cancel stops the run as failed.
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

const issues = [39, 41, 43].map((number) =>
	ticket(number, "2026-10-25T09:00:00Z"),
);

const blockedId = "20261025-143000-b10c";
const runs = [
	...hubRuns.runs.filter((run) => run.ticket === "41" || run.ticket === "39"),
	...hubRuns.runs
		.filter((run) => run.ticket === "41")
		.map((run) => ({
			...run,
			id: blockedId,
			ticket: "43",
			status: { kind: "blocked", reason: "needs-human" },
		})),
];

const cancelled = new Set<string>();
const shownRuns = () => ({
	runs: runs.map((run) =>
		cancelled.has(run.id)
			? { ...run, status: { kind: "failed", reason: "cancelled" } }
			: run,
	),
});
const cancelOf = (id: string) => () => {
	cancelled.add(id);
	return {};
};

await serveRecorded({
	prefix: "project-flow-707-",
	port: process.argv[2]?.trim() || "4707",
	config: {
		pinned: [{ tracker: "github", repo }],
		factories: [{ name: "work hub", url: hubUrl }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		theme: process.env.THEME ?? "light",
	},
	fetch: factoryFetch(
		{
			[hubUrl]: {
				...hub,
				"/runs": shownRuns,
				[`/runs/${blockedId}/cancel`]: cancelOf(blockedId),
				"/runs/20261025-140102-a1b2/cancel": cancelOf("20261025-140102-a1b2"),
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
});
