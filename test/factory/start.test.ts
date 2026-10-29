import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import type { FactoryEntry } from "../../src/factories.ts";
import daemonSlots from "../fixtures/factory-daemon-slots.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import {
	daemon,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	serve,
} from "../support/factory.ts";
import { repo } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import {
	readyLabel,
	serveGithub,
	ticketWhere,
	type TrackerWrite,
	trackerWrites,
} from "./_support.ts";

type Settings = Record<string, unknown>;

function startRun(
	base: string,
	tracker: string,
	project: string,
	key: string,
	factory?: string,
) {
	return fetch(new URL("/api/run-starts", base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			tracker,
			project,
			key,
			...(factory === undefined ? {} : { factory }),
		}),
	});
}

/** A hub with free slots that answers `POST /runs` with `start`, and the recorded runs on a read. */
function hubTaking(start: Response) {
	return {
		...hub,
		"/daemon": daemonSlots,
		"/runs": (_url: URL, method: string) =>
			method === "POST" ? start : hubRuns,
	};
}

function runPosts(requests: FactoryRequest[]) {
	return requests
		.filter(({ method }) => method === "POST")
		.map(({ url, body }) => ({ url, body }));
}

async function factoryEntries(base: string): Promise<FactoryEntry[]> {
	while (true) {
		const response = await fetch(new URL("/api/settings", base));
		const body = (await response.json()) as { factoryEntries: FactoryEntry[] };
		if (body.factoryEntries.every((entry) => entry.reachable !== null)) {
			return body.factoryEntries;
		}
		await Bun.sleep(20);
	}
}

describe("claimed run starts", () => {
	test("Run on a factory with a free slot sends one claimed POST /runs to that factory", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(
				Response.json(
					{ id: "claimed-run", status: { kind: "queued" } },
					{ status: 201 },
				),
			),
		});
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			expect(
				(await factoryEntries(app.base)).map(({ name, slots }) => ({
					name,
					slots,
				})),
			).toEqual([{ name: "work hub", slots: { total: 12, used: 3 } }]);
			const response = await startRun(
				app.base,
				"github",
				repo,
				key,
				"work hub",
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ factory: "work hub" });
			expect(runPosts(app.requests)).toEqual([
				{
					url: `${hubUrl}/runs`,
					body: JSON.stringify({ repo, ticket: "43", claim: true }),
				},
			]);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a claim that another factory holds answers 409 with the reason of the factory", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(
				Response.json(
					{
						error: `ticket 43 of ${repo} is claimed by another daemon`,
					},
					{ status: 409 },
				),
			),
		});
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			const response = await startRun(
				app.base,
				"github",
				repo,
				key,
				"work hub",
			);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: `work hub refused the start: ticket 43 of ${repo} is claimed by another daemon`,
			});
			expect(runPosts(app.requests)).toHaveLength(1);
		} finally {
			await app.stop();
		}
	});

	test("a factory with no source for the repo answers 422 with the reason of the factory", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(
				Response.json({ error: `no source polls ${repo}` }, { status: 422 }),
			),
		});
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			const response = await startRun(
				app.base,
				"github",
				repo,
				key,
				"work hub",
			);
			expect(response.status).toBe(422);
			expect(await response.json()).toEqual({
				error: `work hub has no source for ${repo}: no source polls ${repo}`,
			});
		} finally {
			await app.stop();
		}
	});

	test("a claimed start after a label start that waits for its run answers 409 and sends no POST /runs", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(Response.json({}, { status: 201 })),
		});
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			expect((await startRun(app.base, "github", repo, key)).status).toBe(200);
			const response = await startRun(
				app.base,
				"github",
				repo,
				key,
				"work hub",
			);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "the run is already requested",
			});
			expect(runPosts(app.requests)).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a ready label kept after a succeeded run still allows a claimed start", async () => {
		const app = await serveGithub([40], {
			readyLabel,
			labels: { 40: [readyLabel] },
			hubAnswers: hubTaking(Response.json({}, { status: 201 })),
		});
		try {
			const key = `${repo}#40`;
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			const response = await startRun(
				app.base,
				"github",
				repo,
				key,
				"work hub",
			);
			expect(response.status).toBe(200);
			expect(runPosts(app.requests)).toHaveLength(1);
		} finally {
			await app.stop();
		}
	});

	test("a claimed start of a ticket with a live run sends no POST /runs", async () => {
		const app = await serveGithub([41], {
			readyLabel,
			hubAnswers: hubTaking(Response.json({}, { status: 201 })),
		});
		try {
			const key = `${repo}#41`;
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			const response = await startRun(
				app.base,
				"github",
				repo,
				key,
				"work hub",
			);
			expect(response.status).toBe(409);
			expect(runPosts(app.requests)).toEqual([]);
		} finally {
			await app.stop();
		}
	});
});

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

	test("a factory without readyLabel refuses the start and sends no tracker write", async () => {
		const app = await serveGithub([43]);
		try {
			const key = `${repo}#43`;
			const view = await ticketWhere(
				app.base,
				repo,
				key,
				(item) => item.title !== "",
			);
			expect(view.runStart).toBeUndefined();
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a --factory list without readyLabel refuses the start, though the configured factory has one", async () => {
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
			expect(view.runStart).toBeUndefined();
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
