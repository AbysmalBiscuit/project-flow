/**
 * A project whose open ticket 43 has no factory run and an open PR 50, a hub
 * with free slots and a full laptop daemon, so the panel of ticket 43 shows the
 * "Start run" split button, the ticket link and the PR link. Its thread is long, so the panel scrolls.
 * With `--no-factory` after the port, the configuration has no factory, so the panel shows no run control.
 */
import daemonSlots from "../test/fixtures/factory-daemon-slots.json";
import daemonSources from "../test/fixtures/factory-daemon-sources.json";
import hubRuns from "../test/fixtures/factory-hub-runs.json";
import recordedComments from "../test/fixtures/github-issue-comments-205.json";
import { factoryFetch, hub, hubUrl } from "../test/support/factory.ts";
import { json, urlOf } from "../test/support/fetch.ts";
import {
	issuesResponse,
	page,
	pull,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	ticket,
	unrecorded,
} from "../test/support/github.ts";
import { githubPullNode } from "../test/support/repo-read.ts";
import { serveRecorded } from "./recorded.ts";

const thread = Array.from({ length: 12 }, (_, index) => {
	const comment = recordedComments[index % recordedComments.length];
	return { ...comment, id: index + 1, node_id: `comment-${index + 1}` };
});

const laptopUrl = "http://laptop.test:7777";
const boxUrl = "http://box-a.test:7777";

const sentRun = hubRuns.runs[0];
const boxRun = { ...sentRun, source: null, rule: null, machine: "local" };

function runs(listed: unknown[], start: () => Response) {
	return (_url: URL, method: string) => {
		if (method !== "POST") {
			return { runs: listed };
		}
		return start();
	};
}

await serveRecorded({
	prefix: "project-flow-759-",
	port: process.argv[2]?.trim() || "4759",
	config: {
		pinned: [{ tracker: "github", repo }],
		factories: process.argv.includes("--no-factory")
			? []
			: [
					{
						name: "work hub",
						url: hubUrl,
						readyLabel: "ready-for-agent",
					},
					{ name: "laptop", url: laptopUrl },
					{ name: "box-a", url: boxUrl },
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
				"/runs": runs([sentRun], () =>
					Response.json(
						{
							id: "hub-queued-start",
							repo,
							ticket: "43",
							status: { kind: "submitted", reason: null },
						},
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
				"/runs": runs([], () =>
					Response.json({ error: `no source polls ${repo}` }, { status: 422 }),
				),
			},
			[boxUrl]: {
				"/daemon": {
					...daemonSlots,
					role: "daemon",
					max_runs: 4,
					slots: { total: 4, used: 1 },
				},
				"/sources": daemonSources,
				"/runs": runs([boxRun], () =>
					Response.json(
						{ id: "box-start", status: { kind: "submitted", reason: null } },
						{ status: 201 },
					),
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
				issuesResponse(
					input,
					init,
					[ticket(43, "2026-10-25T09:00:00Z")],
					repo,
					[githubPullNode(pull(50, 43))],
				) ??
				(url === `https://api.github.com/repos/${repo}/issues/43`
					? json(ticket(43, "2026-10-25T09:00:00Z"))
					: null) ??
				(url.includes("/issues/43/comments") ? page(thread) : null) ??
				recordedOrEmpty(url) ??
				(url.includes("/dependencies/") ? page([]) : unrecorded(input, init))
			);
		},
	),
	now: () => new Date("2026-10-25T14:20:00.000Z"),
});
