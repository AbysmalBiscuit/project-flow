/**
 * A project whose open ticket 43 has no factory run, and a hub with a ready
 * label. The fake GitHub records the label that Start run adds.
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

const labels: string[] = [];

await serveRecorded({
	prefix: "project-flow-708-",
	port: process.argv[2]?.trim() || "4708",
	config: {
		pinned: [{ tracker: "github", repo }],
		factories: [
			{ name: "work hub", url: hubUrl, readyLabel: "ready-for-agent" },
		],
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
			if (
				url.endsWith(`/repos/${repo}/issues/43/labels`) &&
				init?.method === "POST"
			) {
				const sent = JSON.parse(String(init.body)) as { labels: string[] };
				labels.push(...sent.labels);
				console.log(`label write: ${init.body}`);
				return json(labels.map((name) => ({ name })));
			}
			return (
				recordedDiscovery(input, init) ??
				issuesResponse(input, init, [
					{ ...ticket(43, "2026-10-25T09:00:00Z"), labels },
				]) ??
				recordedOrEmpty(url) ??
				(url.includes("/dependencies/") ? page([]) : unrecorded(input, init))
			);
		},
	),
	now: () => new Date("2026-10-25T14:20:00.000Z"),
});
