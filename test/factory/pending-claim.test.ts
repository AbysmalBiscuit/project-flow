import { describe, expect, test } from "bun:test";

import daemonSlots from "../fixtures/factory-daemon-slots.json";
import { hubUrl } from "../support/factory.ts";
import { repo } from "../support/github.ts";
import {
	accepted,
	hubListing,
	hubTaking,
	readyLabel,
	runPosts,
	serveGithub,
	startRun,
	ticket40Run,
	ticketWhere,
} from "./_support.ts";

describe("pending claimed starts", () => {
	test("a second claimed start of a fresh ticket answers 409 while the factory has not listed the first run", async () => {
		const app = await serveGithub([43], {
			hubAnswers: hubTaking(accepted()),
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

	test("a claim stays requested while another new run of the ticket shows, and ends at the run that the hub sent it as", async () => {
		let listed: object[] = [];
		const app = await serveGithub([40], {
			readyLabel,
			hubAnswers: hubListing(() => listed, accepted("hub-queued-start")),
		});
		try {
			const key = `${repo}#40`;
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			expect(
				(await startRun(app.base, "github", repo, key, "work hub")).status,
			).toBe(200);
			listed = [ticket40Run("other-run", "14:10")];
			app.advance(60 * 60_000);
			const other = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun?.id === "other-run",
			);
			expect(other.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
				requested: true,
			});
			listed = [
				{ ...ticket40Run("box-run", "14:12"), queued_id: "hub-queued-start" },
				ticket40Run("other-run", "14:10"),
			];
			app.advance(60 * 60_000);
			const ended = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun?.id === "box-run",
			);
			expect(ended.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
			});
			expect(
				(await startRun(app.base, "github", repo, key, "work hub")).status,
			).toBe(200);
			expect(runPosts(app.requests)).toHaveLength(2);
		} finally {
			await app.stop();
		}
	});

	test("the accepted run ends the claim, though the factory dates it before the claim and renames it once sent", async () => {
		let listed: object[] = [];
		const app = await serveGithub([40], {
			readyLabel,
			hubAnswers: hubListing(() => listed, accepted("hub-queued-start")),
		});
		try {
			const key = `${repo}#40`;
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			expect(
				(await startRun(app.base, "github", repo, key, "work hub")).status,
			).toBe(200);
			listed = [ticket40Run("hub-queued-start", "14:10")];
			app.advance(60 * 60_000);
			const ended = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun?.id === "hub-queued-start",
			);
			expect(ended.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
			});
			listed = [
				{ ...ticket40Run("box-run", "14:10"), queued_id: "hub-queued-start" },
			];
			app.advance(60 * 60_000);
			const renamed = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun?.id === "box-run",
			);
			expect(renamed.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
			});
			expect(
				(await startRun(app.base, "github", repo, key, "work hub")).status,
			).toBe(200);
			expect(runPosts(app.requests)).toHaveLength(2);
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
						method === "POST" ? accepted() : { runs: [] },
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

	test("an accepted claim with no run stays requested after its factory frees a slot", async () => {
		let slots = { total: 2, used: 2 };
		const app = await serveGithub([43], {
			hubAnswers: {
				...hubTaking(accepted()),
				"/daemon": () => ({ ...daemonSlots, slots }),
			},
		});
		const daemonReads = () =>
			app.requests.filter(({ url }) => url === `${hubUrl}/daemon`).length;
		const refreshed = async () => {
			const before = daemonReads();
			await fetch(new URL("/api/refresh", app.base), { method: "POST" });
			while (daemonReads() === before) {
				await Bun.sleep(20);
			}
		};
		try {
			const key = `${repo}#43`;
			await ticketWhere(app.base, repo, key, (view) => view.title !== "");
			expect(
				(await startRun(app.base, "github", repo, key, "work hub")).status,
			).toBe(200);
			slots = { total: 2, used: 1 };
			app.advance(60 * 60_000);
			await refreshed();
			const held = await ticketWhere(app.base, repo, key, () => true);
			expect(held.runStart).toEqual({ requested: true });
			const again = await startRun(app.base, "github", repo, key, "work hub");
			expect(again.status).toBe(409);
			expect(await again.json()).toEqual({
				error: "the run is already requested",
			});
			expect(runPosts(app.requests)).toHaveLength(1);
		} finally {
			await app.stop();
		}
	});
});
