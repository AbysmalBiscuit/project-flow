import { describe, expect, test } from "bun:test";

import linearSources from "../fixtures/factory-hub-linear-sources.json";
import { factoryFetch, hub, hubUrl, serve } from "../support/factory.ts";
import { linearFake } from "../support/linear.ts";
import {
	readyLabel,
	sourcesWithRules,
	startRun,
	ticketWhere,
	type TrackerWrite,
	trackerWrites,
} from "./_support.ts";

/** A hub with these sources, and the Linear ticket PF-1 in Backlog with the label `factory:failed`. */
async function serveBacklogTicket(sources: unknown) {
	const writes: TrackerWrite[] = [];
	const tracker = linearFake({
		project: {
			id: "11111111-1111-4111-8111-111111111111",
			name: "Widget launch",
			slugId: "widget-launch",
		},
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
				updatedAt: "2026-08-18T12:00:00.000Z",
				labels: { nodes: [{ name: "factory:failed" }] },
				comments: { nodes: [] },
				team: { id: "team-pf" },
			},
		],
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
		labels: [
			{ id: "label-other-team", name: "factory", team: { id: "team-xx" } },
			{ id: "label-pf", name: "factory", team: { id: "team-pf" } },
			{ id: "label-bug", name: "bug", team: { id: "team-pf" } },
			{ id: "label-failed", name: "factory:failed", team: null },
		],
	});
	const app = await serve(
		[],
		{
			pinned: [{ tracker: "linear", project: "widget-launch" }],
			factories: [{ name: "work hub", url: hubUrl }],
		},
		factoryFetch(
			{ [hubUrl]: { ...hub, "/sources": sources } },
			[],
			trackerWrites(writes, tracker),
		),
		{ env: { LINEAR_API_KEY: "recorded-linear-key" } },
	);
	return { app, writes };
}

describe("Linear run starts", () => {
	test("Start run on a Linear ticket in another workflow state writes the state and labels that its hub source maps to ready", async () => {
		const { app, writes } = await serveBacklogTicket(linearSources);
		try {
			const view = await ticketWhere(
				app.base,
				"Widget launch",
				"PF-1",
				(item) => item.runStart !== undefined,
			);
			expect(view.runStart).toEqual({
				factory: "work hub",
				state: "Todo",
				add: ["factory"],
				remove: ["factory:failed"],
			});
			const response = await startRun(
				app.base,
				"linear",
				"Widget launch",
				"PF-1",
			);
			expect(response.status).toBe(200);
			expect(
				writes.map(
					(write) =>
						(JSON.parse(write.body) as { variables: unknown }).variables,
				),
			).toEqual([
				{
					id: "issue-pf-1",
					input: {
						stateId: "state-todo",
						addedLabelIds: ["label-pf"],
						removedLabelIds: ["label-failed"],
					},
				},
			]);
			await ticketWhere(
				app.base,
				"Widget launch",
				"PF-1",
				(item) => item.runStart?.requested === true,
			);
			const again = await startRun(app.base, "linear", "Widget launch", "PF-1");
			expect(again.status).toBe(409);
			expect(writes).toHaveLength(1);
		} finally {
			await app.stop();
		}
	});

	test("Start run on a Linear ticket skips a rule on another state and writes the ready mapping", async () => {
		const { app, writes } = await serveBacklogTicket(
			sourcesWithRules([
				{ name: "review", state: "In Review", labels: [], without: [] },
				{ name: "build", state: "Ready", labels: ["bug"], without: [] },
			]),
		);
		try {
			const view = await ticketWhere(
				app.base,
				"Widget launch",
				"PF-1",
				(item) => item.runStart !== undefined,
			);
			expect(view.runStart).toEqual({
				factory: "work hub",
				state: "Todo",
				add: ["factory", "bug"],
				remove: ["factory:failed"],
			});
			const response = await startRun(
				app.base,
				"linear",
				"Widget launch",
				"PF-1",
			);
			expect(response.status).toBe(200);
			expect(
				writes.map(
					(write) =>
						(JSON.parse(write.body) as { variables: unknown }).variables,
				),
			).toEqual([
				{
					id: "issue-pf-1",
					input: {
						stateId: "state-todo",
						addedLabelIds: ["label-pf", "label-bug"],
						removedLabelIds: ["label-failed"],
					},
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a Linear ticket that each ready rule excludes refuses the start, though a rule on another state matches", async () => {
		const { app, writes } = await serveBacklogTicket(
			sourcesWithRules([
				{ name: "review", state: "In Review", labels: [], without: [] },
				{
					name: "build",
					state: "Ready",
					labels: [],
					without: ["factory:failed"],
				},
			]),
		);
		try {
			await ticketWhere(
				app.base,
				"Widget launch",
				"PF-1",
				(item) => item.title !== "",
			);
			const refusal = "no ready rule of the hub source takes the ticket";
			let response = await startRun(
				app.base,
				"linear",
				"Widget launch",
				"PF-1",
			);
			let error = ((await response.json()) as { error?: string }).error;
			// The ticket read can end before the first read of the hub sources.
			while (response.status === 409 && error !== refusal) {
				await Bun.sleep(20);
				response = await startRun(app.base, "linear", "Widget launch", "PF-1");
				error = ((await response.json()) as { error?: string }).error;
			}
			expect(response.status).toBe(409);
			expect(error).toBe(refusal);
			expect(writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a Linear ticket of a team that no hub source has refuses the start", async () => {
		const writes: TrackerWrite[] = [];
		const tracker = linearFake({
			project: {
				id: "11111111-1111-4111-8111-111111111111",
				name: "Widget launch",
				slugId: "widget-launch",
			},
			issues: [
				{
					id: "issue-ops-1",
					identifier: "OPS-1",
					title: "Other team",
					description: "Body",
					state: { id: "state-todo", name: "Todo", type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: [] },
					team: { id: "team-ops" },
				},
			],
		});
		const app = await serve(
			[],
			{
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				factories: [{ name: "work hub", url: hubUrl, readyLabel }],
			},
			factoryFetch(
				{ [hubUrl]: { ...hub, "/sources": linearSources } },
				[],
				trackerWrites(writes, tracker),
			),
			{ env: { LINEAR_API_KEY: "recorded-linear-key" } },
		);
		try {
			const view = await ticketWhere(
				app.base,
				"Widget launch",
				"OPS-1",
				(item) => item.title !== "",
			);
			expect(view.runStart).toBeUndefined();
			const response = await startRun(
				app.base,
				"linear",
				"Widget launch",
				"OPS-1",
			);
			expect(response.status).toBe(409);
			expect(writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});
});
