import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import linearSources from "../fixtures/factory-hub-linear-sources.json";
import { factoryFetch, hub, hubUrl, serve } from "../support/factory.ts";
import { repo } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import {
	readyLabel,
	serveGithub,
	startRun,
	ticketWhere,
	type TrackerWrite,
	trackerWrites,
} from "./_support.ts";

type Settings = Record<string, unknown>;

function sourcesWithRules(
	rules: { name: string; state: string; labels: string[]; without: string[] }[],
) {
	return {
		...linearSources,
		sources: linearSources.sources.map((source) => ({ ...source, rules })),
	};
}

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

describe("run starts", () => {
	test("Start run on an open GitHub ticket adds the ready label of the factory", async () => {
		const app = await serveGithub([43], { readyLabel });
		try {
			const key = `${repo}#43`;
			expect(
				(await ticketWhere(app.base, repo, key, (view) => view.title !== ""))
					.runStart,
			).toEqual({ factory: "work hub", label: readyLabel });
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(200);
			expect(app.writes).toEqual([
				{
					url: `https://api.github.com/repos/${repo}/issues/43/labels`,
					body: JSON.stringify({ labels: [readyLabel] }),
				},
			]);
			const requested = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.runStart?.requested === true,
			);
			expect(requested.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
				requested: true,
			});
		} finally {
			await app.stop();
		}
	});

	test("a ticket whose newest run succeeded can start a run, and a ticket with a live run cannot", async () => {
		const app = await serveGithub([40, 41], { readyLabel });
		try {
			const succeeded = await ticketWhere(
				app.base,
				repo,
				`${repo}#40`,
				(view) => view.factoryRun !== undefined,
			);
			expect(succeeded.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
			});
			const live = await ticketWhere(
				app.base,
				repo,
				`${repo}#41`,
				(view) => view.factoryRun !== undefined,
			);
			expect(live.runStart).toBeUndefined();
			const response = await startRun(app.base, "github", repo, `${repo}#41`);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a ready label kept after a succeeded run allows a new start, and the new request refuses a second one", async () => {
		const key = `${repo}#40`;
		const app = await serveGithub([40], {
			readyLabel,
			labels: { 40: [readyLabel] },
		});
		try {
			const kept = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			expect(kept.runStart).toEqual({ factory: "work hub", label: readyLabel });
			const started = await startRun(app.base, "github", repo, key);
			expect(started.status).toBe(200);
			expect(app.writes).toHaveLength(1);
			const requested = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.runStart?.requested === true,
			);
			expect(requested.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
				requested: true,
			});
			const again = await startRun(app.base, "github", repo, key);
			expect(again.status).toBe(409);
			expect(app.writes).toHaveLength(1);
		} finally {
			await app.stop();
		}
	});

	test("a ready label on a ticket with no run shows the run as requested and refuses a second start", async () => {
		const key = `${repo}#43`;
		const app = await serveGithub([43], {
			readyLabel,
			labels: { 43: [readyLabel] },
		});
		try {
			const view = await ticketWhere(
				app.base,
				repo,
				key,
				(item) => item.title !== "",
			);
			expect(view.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
				requested: true,
			});
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a ready label saved through Settings gives the start, and a later save keeps it", async () => {
		const key = `${repo}#43`;
		const app = await serveGithub([43]);
		const save = async (change: (settings: Settings) => Settings) => {
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as Settings;
			const saved = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				body: JSON.stringify(change(settings)),
			});
			expect(saved.status).toBe(200);
		};
		try {
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			await save((settings) => ({
				...settings,
				factories: [{ name: "work hub", url: hubUrl, readyLabel }],
			}));
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.runStart !== undefined,
			);
			await save((settings) => ({ ...settings, theme: "dark" }));
			const written = JSON.parse(await readFile(app.configPath, "utf8")) as {
				factories: unknown;
			};
			expect(written.factories).toEqual([
				{ name: "work hub", url: hubUrl, readyLabel },
			]);
			const kept = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.title !== "",
			);
			expect(kept.runStart).toEqual({ factory: "work hub", label: readyLabel });
		} finally {
			await app.stop();
		}
	});

	test("a closed ticket refuses the start and sends no tracker write", async () => {
		const app = await serveGithub([43], { readyLabel, closed: [43] });
		try {
			const key = `${repo}#43`;
			const closed = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.title !== "",
			);
			expect(closed.runStart).toBeUndefined();
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a factory without readyLabel refuses a label start, and the GitHub ticket keeps a claimed start", async () => {
		const app = await serveGithub([43]);
		try {
			const key = `${repo}#43`;
			const view = await ticketWhere(
				app.base,
				repo,
				key,
				(item) => item.title !== "",
			);
			expect(view.runStart).toEqual({});
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a --factory list without readyLabel refuses a label start, though the configured factory has one", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			args: ["--factory", `flag hub=${hubUrl}`],
		});
		try {
			const key = `${repo}#43`;
			const view = await ticketWhere(
				app.base,
				repo,
				key,
				(item) => item.title !== "",
			);
			expect(view.runStart).toEqual({});
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

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
