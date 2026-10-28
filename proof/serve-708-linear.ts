/**
 * A Linear project whose open ticket PF-1 has no factory run, and a hub with a
 * ready label. The fake Linear holds a team label of that name.
 */
import { daemon, factoryFetch, hubUrl } from "../test/support/factory.ts";
import { linearFake } from "../test/support/linear.ts";
import { serveRecorded } from "./recorded.ts";

const readyLabel = "ready-for-agent";

await serveRecorded({
	prefix: "project-flow-708-linear-",
	port: process.argv[2]?.trim() || "4709",
	config: {
		pinned: [{ tracker: "linear", project: "widget-launch" }],
		factories: [{ name: "work hub", url: hubUrl, readyLabel }],
		checkoutRoots: [],
		theme: "light",
	},
	fetch: factoryFetch(
		{ [hubUrl]: daemon },
		[],
		linearFake({
			project: {
				id: "11111111-1111-4111-8111-111111111111",
				name: "Widget launch",
				slugId: "widget-launch",
			},
			issues: [
				{
					id: "issue-pf-1",
					identifier: "PF-1",
					title: "Ready ticket",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: [] },
					team: { id: "team-pf" },
				},
			],
			labels: [{ id: "label-pf", name: readyLabel, team: { id: "team-pf" } }],
		}),
	),
});
