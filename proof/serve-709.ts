/**
 * A project whose open ticket 43 has no factory run, a hub with free slots and
 * a full laptop daemon. `POST /runs` of each factory answers as the factory
 * does: the hub queues the claimed start, and the laptop has no source for the repo.
 */
import daemonSlots from "../test/fixtures/factory-daemon-slots.json";
import daemonSources from "../test/fixtures/factory-daemon-sources.json";
import { factoryFetch, hub, hubUrl } from "../test/support/factory.ts";
import { json, urlOf } from "../test/support/fetch.ts";
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

const laptopUrl = "http://laptop.test:7777";

function runs(start: () => Response) {
	return (_url: URL, method: string) => {
		if (method !== "POST") {
			return { runs: [] };
		}
		return start();
	};
}

await serveRecorded({
	prefix: "project-flow-709-",
	port: process.argv[2]?.trim() || "4709",
	config: {
		pinned: [{ tracker: "github", repo }],
		factories: [
			{ name: "work hub", url: hubUrl, readyLabel: "ready-for-agent" },
			{ name: "laptop", url: laptopUrl },
		],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		theme: "light",
		projectViews: { [repo]: { openView: "board" } },
	},
	fetch: factoryFetch(
		{
			[hubUrl]: {
				...hub,
				"/daemon": daemonSlots,
				"/runs": runs(() =>
					Response.json(
						{ id: 7, repo, ticket: "43", state: "queued" },
						{ status: 201 },
					),
				),
			},
			[laptopUrl]: {
				"/daemon": {
					...daemonSlots,
					role: "daemon",
					max_runs: 2,
					slots: { total: 2, used: 2 },
				},
				"/sources": daemonSources,
				"/runs": runs(() =>
					Response.json({ error: `no source polls ${repo}` }, { status: 422 }),
				),
			},
		},
		[],
		async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return json({ login: "lev" });
			}
			return (
				recordedDiscovery(input, init) ??
				issuesResponse(input, init, [ticket(43, "2026-10-25T09:00:00Z")]) ??
				recordedOrEmpty(url) ??
				(url.includes("/dependencies/") ? page([]) : unrecorded(input, init))
			);
		},
	),
	now: () => new Date("2026-10-25T14:20:00.000Z"),
});
