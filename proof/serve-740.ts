/**
 * Serves a `Widget launch` Linear project with one Backlog ticket, and a hub
 * whose Linear source maps `Ready` to the workflow state Todo plus labels.
 * Start run on PF-1 shows the state that the start sets.
 *
 * Usage: bun proof/serve-740.ts [PORT]
 */
import linearSources from "../test/fixtures/factory-hub-linear-sources.json";
import { factoryFetch, hub, hubUrl } from "../test/support/factory.ts";
import { linearFake } from "../test/support/linear.ts";
import { serveRecorded } from "./recorded.ts";

await serveRecorded({
	prefix: "project-flow-740-",
	port: process.argv[2]?.trim() || "4740",
	config: {
		pinned: [{ tracker: "linear", project: "widget-launch" }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		factories: [{ name: "work hub", url: hubUrl }],
	},
	fetch: factoryFetch(
		{ [hubUrl]: { ...hub, "/sources": linearSources } },
		[],
		linearFake({
			project: {
				id: "11111111-1111-4111-8111-111111111111",
				name: "Widget launch",
				slugId: "widget-launch",
			},
			states: [
				{
					id: "state-backlog",
					name: "Backlog",
					type: "backlog",
					position: 0,
					color: "#bec2c8",
				},
				{
					id: "state-todo",
					name: "Todo",
					type: "unstarted",
					position: 1,
					color: "#e2e2e2",
				},
			],
			issues: [
				{
					id: "issue-pf-1",
					identifier: "PF-1",
					title: "Backlog ticket",
					description: "Body",
					state: {
						id: "state-backlog",
						name: "Backlog",
						type: "backlog",
						color: "#bec2c8",
					},
					updatedAt: "2026-10-18T11:00:00.000Z",
					labels: { nodes: [{ name: "factory:failed" }] },
					comments: { nodes: [] },
					attachments: { nodes: [] },
					team: { id: "team-pf" },
				},
			],
			labels: [
				{ id: "label-pf", name: "factory", team: { id: "team-pf" } },
				{ id: "label-failed", name: "factory:failed", team: null },
			],
		}),
	),
});
