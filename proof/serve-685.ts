import hubRuns from "../test/fixtures/factory-hub-runs.json";
/**
 * A project with every kind of clickable control: a running and a failed run
 * for the Runs list and the Resume split button, and a blocker from a second
 * tracked project for the context menu of its chip.
 */
import { factoryFetch, hub, hubUrl } from "../test/support/factory.ts";
import { urlOf } from "../test/support/fetch.ts";
import {
	issuesResponse,
	otherRepo,
	page,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	ticket,
	unrecorded,
} from "../test/support/github.ts";
import { serveRecorded } from "./recorded.ts";

const started = Date.now();

const blockers: Record<number, string[]> = {
	33: ["#31", `${otherRepo}#5`],
	34: ["#31", "#32"],
	35: ["#33"],
};

const issues = [31, 32, 33, 34, 35, 36, 37, 38].map((number) => ({
	...ticket(number, "2026-10-25T09:00:00Z"),
	body: (blockers[number] ?? [])
		.map((blocker) => `Blocked by: ${blocker}`)
		.join("\n"),
}));

const otherIssues = [
	{
		...ticket(5, "2026-10-25T09:00:00Z"),
		html_url: `https://github.com/${otherRepo}/issues/5`,
	},
];

const ticketOf: Record<string, string> = { "41": "37", "39": "38" };
const runs = hubRuns.runs.flatMap((run) => {
	const mapped = ticketOf[run.ticket];
	return mapped === undefined ? [] : [{ ...run, ticket: mapped }];
});

await serveRecorded({
	prefix: "project-flow-685-",
	port: process.argv[2]?.trim() || "4685",
	config: {
		pinned: [
			{ tracker: "github", repo },
			{ tracker: "github", repo: otherRepo },
		],
		factories: [{ name: "work hub", url: hubUrl }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		theme: process.argv[3] === "dark" ? "dark" : "light",
	},
	fetch: factoryFetch(
		{ [hubUrl]: { ...hub, "/runs": () => ({ runs }) } },
		[],
		async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			return (
				recordedDiscovery(input, init) ??
				issuesResponse(input, init, issues) ??
				issuesResponse(input, init, otherIssues, otherRepo) ??
				recordedOrEmpty(url) ??
				(url.includes("/dependencies/") ? page([]) : unrecorded(input, init))
			);
		},
	),
	now: () =>
		new Date(Date.parse("2026-10-25T14:20:00.000Z") + Date.now() - started),
});
