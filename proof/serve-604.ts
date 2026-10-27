/** A hub whose runs carry usage totals, for the Cost column of the Runs list. */
import { factoryFetch, hub, hubUrl } from "../test/factory-support.ts";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import {
	issuesResponse,
	page,
	recordedOrEmpty,
	repo,
	ticket,
} from "../test/live-support.ts";
import { recordedDiscovery, unrecorded, urlOf } from "../test/support.ts";
import { serveRecorded } from "./recorded.ts";

const costs: Record<string, number> = {
	"41": 0.82,
	"40": 4.37,
	"42": 0,
	"39": 12.05,
};

const runs = hubRuns.runs.map((run) => {
	const cost = costs[run.ticket];
	return cost === undefined
		? run
		: {
				...run,
				usage: {
					tokens: { input: Math.round(cost * 90_000), output: 4_200 },
					cost_usd: cost,
					duration_s: Math.round(cost * 300),
				},
			};
});

await serveRecorded({
	prefix: "project-flow-604-",
	port: process.argv[2]?.trim() || "4604",
	config: {
		pinned: [{ tracker: "github", repo }],
		factories: [{ name: "work hub", url: hubUrl }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		theme: "light",
	},
	fetch: factoryFetch(
		{ [hubUrl]: { ...hub, "/runs": { runs } } },
		[],
		async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			return (
				recordedDiscovery(input, init) ??
				issuesResponse(
					input,
					init,
					[39, 40, 41, 42].map((number) =>
						ticket(number, "2026-10-25T09:00:00Z"),
					),
				) ??
				recordedOrEmpty(url) ??
				(url.includes("/dependencies/") ? page([]) : unrecorded(input, init))
			);
		},
	),
	now: () => new Date("2026-10-25T14:20:00.000Z"),
});
