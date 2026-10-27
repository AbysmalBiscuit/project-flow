/**
 * A project graph whose ticket 37 gains a factory run, and with it a stage
 * chip row, `RUN_AFTER_MS` after the server starts.
 */
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

const runAfterMs = Number(process.env.RUN_AFTER_MS ?? "20000");
const started = Date.now();

const blockers: Record<number, number[]> = {
	33: [31],
	34: [31, 32],
	35: [33],
	36: [34],
	41: [35, 36],
	42: [41],
	43: [41],
	44: [36],
};

const issues = [31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44].map(
	(number) => ({
		...ticket(number, "2026-10-25T09:00:00Z"),
		body: (blockers[number] ?? [])
			.map((blocker) => `Blocked by: #${blocker}`)
			.join("\n"),
		...(number === 37
			? {
					commentRows: [
						{
							id: 1,
							body: "**Workcell progress**\n\n- stage 3: writing the change",
							user: { login: "lev" },
							created_at: "2026-10-25T09:30:00Z",
							updated_at: "2026-10-25T14:10:00Z",
						},
					],
				}
			: {}),
	}),
);

const running = hubRuns.runs
	.filter((run) => run.ticket === "41")
	.map((run) => ({ ...run, ticket: "37" }));

await serveRecorded({
	prefix: "project-flow-666-",
	port: process.argv[2]?.trim() || "4666",
	config: {
		pinned: [{ tracker: "github", repo }],
		factories: [{ name: "work hub", url: hubUrl }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		theme: "light",
		projectViews: { [repo]: { openView: "graph" } },
	},
	fetch: factoryFetch(
		{
			[hubUrl]: {
				...hub,
				"/runs": () => ({
					runs: Date.now() - started < runAfterMs ? [] : running,
				}),
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
		new Date(Date.parse("2026-10-25T14:20:00.000Z") + Date.now() - started),
});
