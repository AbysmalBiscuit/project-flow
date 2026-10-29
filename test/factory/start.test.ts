import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import daemonSlots from "../fixtures/factory-daemon-slots.json";
import {
	daemon,
	factoryFetch,
	hubUrl,
	laptopUrl,
	serve,
} from "../support/factory.ts";
import { repo } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import {
	hubListing,
	readyLabel,
	serveGithub,
	startRun,
	ticket40Run,
	ticketWhere,
	type TrackerWrite,
	trackerWrites,
} from "./_support.ts";

type Settings = Record<string, unknown>;

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

	test("a label start ends at a new hub-source run of the ticket on its factory, though the factory dates it before the start", async () => {
		let listed: object[] = [];
		const app = await serveGithub([40], {
			readyLabel,
			hubAnswers: hubListing(() => listed),
		});
		try {
			const key = `${repo}#40`;
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			expect((await startRun(app.base, "github", repo, key)).status).toBe(200);
			listed = [ticket40Run("hub-run", "14:10")];
			app.advance(60 * 60_000);
			const ended = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun?.id === "hub-run",
			);
			expect(ended.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
			});
		} finally {
			await app.stop();
		}
	});

	test("a label start stays requested while the only new run of the ticket is on another factory or has no source", async () => {
		let listed: object[] = [];
		let laptopRuns: object[] = [];
		const app = await serveGithub([40], {
			readyLabel,
			hubAnswers: hubListing(() => listed),
			otherFactory: {
				name: "laptop",
				url: laptopUrl,
				answers: {
					"/daemon": daemonSlots,
					"/sources": { sources: [] },
					"/runs": () => ({ runs: laptopRuns }),
				},
			},
		});
		const requested = {
			factory: "work hub",
			label: readyLabel,
			requested: true,
		} as const;
		try {
			const key = `${repo}#40`;
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			expect((await startRun(app.base, "github", repo, key)).status).toBe(200);
			laptopRuns = [ticket40Run("laptop-run", "14:30")];
			app.advance(60 * 60_000);
			const elsewhere = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun?.id === "laptop-run",
			);
			expect(elsewhere.runStart).toEqual(requested);
			listed = [{ ...ticket40Run("sourceless-run", "14:40"), source: null }];
			app.advance(60 * 60_000);
			const sourceless = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun?.id === "sourceless-run",
			);
			expect(sourceless.runStart).toEqual(requested);
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
				(view) => view.runStart?.label === readyLabel,
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

	test("Start run on a Linear ticket adds the team's ready label", async () => {
		const writes: TrackerWrite[] = [];
		const issue = {
			id: "issue-pf-1",
			identifier: "PF-1",
			title: "Ready ticket",
			description: "Body",
			state: { type: "unstarted" },
			updatedAt: "2026-08-18T12:00:00.000Z",
			labels: { nodes: [] },
			comments: { nodes: [] },
			team: { id: "team-pf" },
		};
		const tracker = linearFake({
			project: {
				id: "11111111-1111-4111-8111-111111111111",
				name: "Widget launch",
				slugId: "widget-launch",
			},
			issues: [issue],
			labels: [
				{ id: "label-other-team", name: readyLabel, team: { id: "team-xx" } },
				{ id: "label-pf", name: readyLabel, team: { id: "team-pf" } },
			],
		});
		const app = await serve(
			[],
			{
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				factories: [{ name: "work hub", url: hubUrl, readyLabel }],
			},
			factoryFetch({ [hubUrl]: daemon }, [], trackerWrites(writes, tracker)),
			{ env: { LINEAR_API_KEY: "recorded-linear-key" } },
		);
		try {
			const view = await ticketWhere(
				app.base,
				"Widget launch",
				"PF-1",
				(item) => item.title !== "",
			);
			expect(view.runStart).toEqual({ factory: "work hub", label: readyLabel });
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
			).toEqual([{ id: "issue-pf-1", labelId: "label-pf" }]);
			const requested = await ticketWhere(
				app.base,
				"Widget launch",
				"PF-1",
				(item) => item.runStart?.requested === true,
			);
			expect(requested.runStart?.label).toBe(readyLabel);
		} finally {
			await app.stop();
		}
	});
});
