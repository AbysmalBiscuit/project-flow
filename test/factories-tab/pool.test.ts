import { describe, expect, test } from "bun:test";

import {
	type FactoriesPage,
	type FactoryCard,
	factoryCheckMs,
} from "../../src/factories-page.ts";
import pool from "../fixtures/factory-machine-pool.json";
import machine from "../fixtures/factory-machine.json";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hubUrl,
	serve,
} from "../support/factory.ts";
import { clockStart, factoriesWhere, hubAbout } from "./_support.ts";

const [awake, asleep] = pool.machines;
if (awake === undefined || asleep === undefined) {
	throw new Error("the pool fixture lost a box");
}

async function serveHub(answers: Answers) {
	const requests: FactoryRequest[] = [];
	const factories: Record<string, Answers | "down"> = { [hubUrl]: answers };
	let now = Date.parse(clockStart);
	const app = await serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch(factories, requests),
		{
			env: { GITHUB_TOKEN: "recorded-token" },
			now: () => new Date(now),
		},
	);
	return {
		...app,
		requests,
		factories,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

const hubAnswers = (poolAnswer: unknown): Answers => ({
	"/daemon": hubAbout,
	"/sources": { sources: [] },
	"/runs": { runs: [] },
	"/machine": machine,
	"/machines/pool": poolAnswer,
});

const cardOf = (page: FactoriesPage, name: string): FactoryCard | undefined =>
	page.boxes.find((box) => box.name === name);

describe("the box pool of a hub", () => {
	test("an awake box and an asleep box get cards with their state and slots, and the asleep box has no meters", async () => {
		const app = await serveHub(hubAnswers(pool));
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) =>
					cardOf(seen, "spare")?.host !== undefined &&
					cardOf(seen, "spare-2") !== undefined,
			);
			expect(page.boxes.map((box) => box.name)).toEqual([
				"work hub",
				"spare",
				"spare-2",
			]);
			const { host, ...spare } = cardOf(page, "spare") ?? {};
			expect(spare).toEqual({
				name: "spare",
				roles: ["daemon"],
				network: "work hub",
				hub: "work hub",
				state: "awake",
				reachable: true,
				slots: awake.slots,
				heartbeatAt: awake.last_contact,
			});
			expect(host?.cores).toBe(awake.snapshot?.cpu.cores);
			expect(cardOf(page, "spare-2")).toEqual({
				name: "spare-2",
				roles: ["daemon"],
				network: "work hub",
				hub: "work hub",
				state: "asleep",
				reachable: false,
				slots: asleep.slots,
				heartbeatAt: asleep.last_contact,
			});
			expect(page.tiles.slots).toEqual(hubAbout.slots);
		} finally {
			await app.stop();
		}
	});

	test("the boxes of a hub that stops answering keep their cards, so the page does not reflow", async () => {
		const app = await serveHub(hubAnswers(pool));
		try {
			await factoriesWhere(
				app.base,
				(seen) => cardOf(seen, "spare-2") !== undefined,
			);
			app.factories[hubUrl] = "down";
			app.advance(factoryCheckMs);
			const page = await factoriesWhere(
				app.base,
				(seen) => cardOf(seen, "work hub")?.reachable === false,
			);
			expect(page.boxes.map((box) => box.name)).toEqual([
				"work hub",
				"spare",
				"spare-2",
			]);
			expect(cardOf(page, "spare")?.reachable).toBe(false);
		} finally {
			await app.stop();
		}
	});

	test("a hub whose pool holds only its own machine builds its runs, so it is a hub and a daemon", async () => {
		const app = await serveHub(
			hubAnswers({ machines: [{ ...awake, name: "local" }] }),
		);
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) => cardOf(seen, "work hub")?.roles.includes("daemon") === true,
			);
			expect(page.boxes.map(({ name, roles }) => ({ name, roles }))).toEqual([
				{ name: "work hub", roles: ["hub", "daemon"] },
			]);
		} finally {
			await app.stop();
		}
	});

	test("a hub with no pool route keeps the cards from GET /daemon", async () => {
		const app = await serveHub(hubAnswers(null));
		try {
			while (
				!app.requests.some((request) => request.url.endsWith("/machines/pool"))
			) {
				await Bun.sleep(20);
			}
			const page = await factoriesWhere(
				app.base,
				(seen) => cardOf(seen, "work hub")?.host !== undefined,
			);
			expect(page.boxes.map(({ host: _, ...box }) => box)).toEqual([
				{
					name: "work hub",
					roles: ["hub"],
					reachable: true,
					slots: hubAbout.slots,
					heartbeatAt: clockStart,
				},
			]);
			expect(page.notServed).toEqual([]);
		} finally {
			await app.stop();
		}
	});
});
