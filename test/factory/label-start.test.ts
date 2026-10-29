import { describe, expect, test } from "bun:test";

import daemonSlots from "../fixtures/factory-daemon-slots.json";
import { laptopUrl } from "../support/factory.ts";
import { repo } from "../support/github.ts";
import {
	boxRow,
	hubListing,
	readyLabel,
	serveGithub,
	startRun,
	ticket40Run,
	ticketWhere,
} from "./_support.ts";

const key = `${repo}#40`;

const requested = {
	factory: "work hub",
	label: readyLabel,
	requested: true,
} as const;

describe("the end of a label start", () => {
	test("a label start ends at a new hub-source run of the ticket on its factory, though the factory dates it before the start", async () => {
		let listed: object[] = [];
		const app = await serveGithub([40], {
			readyLabel,
			hubAnswers: hubListing(() => listed),
		});
		try {
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
			otherFactories: [
				{
					name: "laptop",
					url: laptopUrl,
					answers: {
						"/daemon": daemonSlots,
						"/sources": { sources: [] },
						"/runs": () => ({ runs: laptopRuns }),
					},
				},
			],
		});
		try {
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

	test("a label start ends at the hub's new run when its box is also listed and gives the run its status", async () => {
		let listed: object[] = [];
		let boxRuns: object[] = [];
		const app = await serveGithub([40], {
			readyLabel,
			hubAnswers: hubListing(() => listed),
			otherFactories: [
				{
					name: "laptop",
					url: laptopUrl,
					answers: {
						"/daemon": daemonSlots,
						"/sources": { sources: [] },
						"/runs": () => ({ runs: boxRuns }),
					},
				},
			],
		});
		try {
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			expect((await startRun(app.base, "github", repo, key)).status).toBe(200);
			const sent = { ...ticket40Run("box-run", "14:30"), machine: "laptop" };
			listed = [sent];
			boxRuns = [boxRow(sent, "succeeded")];
			app.advance(60 * 60_000);
			const ended = await ticketWhere(
				app.base,
				repo,
				key,
				(view) =>
					view.factoryRun?.id === "box-run" &&
					view.factoryRun.factory === "laptop",
			);
			expect(ended.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
			});
		} finally {
			await app.stop();
		}
	});

	test("a run that the factory lists after the last poll and before the label start does not end the start", async () => {
		let listed: object[] = [];
		const app = await serveGithub([40], {
			readyLabel,
			hubAnswers: hubListing(() => listed),
		});
		try {
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			listed = [ticket40Run("unpolled-run", "14:15")];
			expect((await startRun(app.base, "github", repo, key)).status).toBe(200);
			app.advance(60 * 60_000);
			const unpolled = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun?.id === "unpolled-run",
			);
			expect(unpolled.runStart).toEqual(requested);
		} finally {
			await app.stop();
		}
	});

	test("a label start on a factory that does not answer adds the label, and ends at a new run once the factory answers", async () => {
		let listed: object[] = [];
		let down = false;
		const listing = hubListing(() => listed);
		const app = await serveGithub([40], {
			readyLabel,
			hubAnswers: {
				...listing,
				"/runs": (url: URL, method: string) =>
					down && method === "GET"
						? new Response("down", { status: 503 })
						: listing["/runs"](url, method),
			},
		});
		try {
			await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			down = true;
			expect((await startRun(app.base, "github", repo, key)).status).toBe(200);
			expect(app.writes).toHaveLength(1);
			expect(
				(await ticketWhere(app.base, repo, key, () => true)).runStart,
			).toEqual(requested);
			down = false;
			listed = [ticket40Run("hub-run", "14:30")];
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
});
