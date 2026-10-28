/**
 * A project whose open ticket 43 carries the ready label of the hub and has
 * no factory run, so it shows the Queued chip. Ticket 42 has no ready label.
 */
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

const readyLabel = "ready-for-agent";

await serveRecorded({
	prefix: "project-flow-730-",
	port: process.argv[2]?.trim() || "4730",
	config: {
		pinned: [{ tracker: "github", repo }],
		factories: [{ name: "work hub", url: hubUrl, readyLabel }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		theme: "light",
		projectViews: { [repo]: { openView: "board" } },
	},
	fetch: factoryFetch(
		{ [hubUrl]: { ...hub, "/runs": { runs: [] } } },
		[],
		async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return json({ login: "lev" });
			}
			return (
				recordedDiscovery(input, init) ??
				issuesResponse(input, init, [
					{ ...ticket(42, "2026-10-25T09:00:00Z"), labels: [] },
					{ ...ticket(43, "2026-10-25T09:00:00Z"), labels: [readyLabel] },
				]) ??
				recordedOrEmpty(url) ??
				(url.includes("/dependencies/") ? page([]) : unrecorded(input, init))
			);
		},
	),
	now: () => new Date("2026-10-25T14:20:00.000Z"),
});
