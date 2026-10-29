import { describe, expect, test } from "bun:test";

import type { FactoryEntry } from "../../src/factories.ts";
import daemonSlots from "../fixtures/factory-daemon-slots.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import { type FactoryRequest, hub, hubUrl } from "../support/factory.ts";
import { repo } from "../support/github.ts";
import { readyLabel, serveGithub, startRun, ticketWhere } from "./_support.ts";

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
});

describe("claimed start eligibility", () => {
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

	test("a label start whose ready label is removed before its run allows a claimed start", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			hubAnswers: hubTaking(Response.json({}, { status: 201 })),
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

describe("pending claimed starts", () => {
	test("a second claimed start of a fresh ticket answers 409 while the factory has not listed the first run", async () => {
		const app = await serveGithub([43], {
			hubAnswers: hubTaking(Response.json({}, { status: 201 })),
		});
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			const first = await startRun(app.base, "github", repo, key, "work hub");
			expect(first.status).toBe(200);
			expect(
				(
					await ticketWhere(
						app.base,
						repo,
						key,
						(view) => view.runStart !== undefined,
					)
				).runStart,
			).toEqual({ requested: true });
			const second = await startRun(app.base, "github", repo, key, "work hub");
			expect(second.status).toBe(409);
			expect(await second.json()).toEqual({
				error: "the run is already requested",
			});
			expect(runPosts(app.requests)).toHaveLength(1);
		} finally {
			await app.stop();
		}
	});

	test("a claimed start after a succeeded run shows the run as requested and refuses a second start", async () => {
		const app = await serveGithub([40], {
			readyLabel,
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
			const first = await startRun(app.base, "github", repo, key, "work hub");
			expect(first.status).toBe(200);
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
			const claim = await startRun(app.base, "github", repo, key, "work hub");
			expect(claim.status).toBe(409);
			const label = await startRun(app.base, "github", repo, key);
			expect(label.status).toBe(409);
			expect(runPosts(app.requests)).toHaveLength(1);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});
	test("a claim to another factory hides the Queued chip of a ready label kept after a succeeded run", async () => {
		const laptop = "http://laptop.test:7777";
		const app = await serveGithub([40], {
			readyLabel,
			labels: { 40: [readyLabel] },
			otherFactory: {
				name: "laptop",
				url: laptop,
				answers: {
					"/daemon": daemonSlots,
					"/sources": { sources: [] },
					"/runs": (_url: URL, method: string) =>
						method === "POST"
							? Response.json({}, { status: 201 })
							: { runs: [] },
				},
			},
		});
		try {
			const key = `${repo}#40`;
			const kept = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			expect(kept.queued).toBeUndefined();
			const response = await startRun(app.base, "github", repo, key, "laptop");
			expect(response.status).toBe(200);
			expect(runPosts(app.requests)).toEqual([
				{
					url: `${laptop}/runs`,
					body: JSON.stringify({ repo, ticket: "40", claim: true }),
				},
			]);
			const requested = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.runStart?.requested === true,
			);
			expect(requested.queued).toBeUndefined();
			const again = await startRun(app.base, "github", repo, key, "laptop");
			expect(again.status).toBe(409);
			expect(runPosts(app.requests)).toHaveLength(1);
		} finally {
			await app.stop();
		}
	});
});
