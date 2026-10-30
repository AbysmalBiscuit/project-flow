import { describe, expect, test } from "bun:test";

import type { FactoryEntry } from "../../src/factories.ts";
import daemonSlots from "../fixtures/factory-daemon-slots.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import { hubUrl } from "../support/factory.ts";
import { repo } from "../support/github.ts";
import { readWhere } from "../support/reads.ts";
import {
	accepted,
	hubTaking,
	readyLabel,
	runPosts,
	serveGithub,
	startRun,
	ticketWhere,
} from "./_support.ts";

async function factoryEntries(base: string): Promise<FactoryEntry[]> {
	const body = await readWhere<{ factoryEntries: FactoryEntry[] }>(
		new URL("/api/settings", base),
		(read) => read.factoryEntries.every((entry) => entry.reachable !== null),
	);
	return body.factoryEntries;
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
});

describe("claimed start eligibility", () => {
	test("a claimed start after a label start that waits for its run answers 409 and sends no POST /runs", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(accepted()),
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
			hubAnswers: hubTaking(accepted()),
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

	test("a label start whose ready label is removed before its run allows a claimed start", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(accepted()),
		});
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			expect((await startRun(app.base, "github", repo, key)).status).toBe(200);
			app.labels.set(43, []);
			await fetch(new URL("/api/refresh", app.base), { method: "POST" });
			const view = await ticketWhere(
				app.base,
				repo,
				key,
				(item) => item.queued === undefined,
			);
			expect(view.runStart?.requested).toBeUndefined();
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
			hubAnswers: hubTaking(accepted()),
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

	test("a claimed start that names a box a hub also reads answers 409 and sends no POST /runs", async () => {
		const [sentRun] = hubRuns.runs;
		const boxUrl = "http://box-a.test:7777";
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(accepted()),
			otherFactories: [
				{
					name: "box-a",
					url: boxUrl,
					answers: {
						"/daemon": { ...daemonSlots, role: "daemon" },
						"/runs": (_url: URL, method: string) =>
							method === "POST"
								? accepted("box-start")
								: { runs: [{ ...sentRun, machine: "local" }] },
					},
				},
			],
		});
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			await readWhere<{ factoryEntries: FactoryEntry[] }>(
				new URL("/api/settings", app.base),
				(read) =>
					read.factoryEntries.some(
						(entry) =>
							entry.name === "box-a" && entry.alsoReadThroughHub === "work hub",
					),
			);
			const response = await startRun(app.base, "github", repo, key, "box-a");
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "box-a takes no claimed start",
			});
			expect(runPosts(app.requests)).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a claimed start that names an unreachable factory answers 409 and sends no POST /runs", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(accepted()),
			otherFactories: [
				{
					name: "laptop",
					url: "http://laptop.test:7777",
					answers: {
						"/daemon": new Response(null, { status: 500 }),
					},
				},
			],
		});
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			await factoryEntries(app.base);
			const response = await startRun(app.base, "github", repo, key, "laptop");
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "laptop takes no claimed start",
			});
			expect(runPosts(app.requests)).toEqual([]);
		} finally {
			await app.stop();
		}
	});
});
