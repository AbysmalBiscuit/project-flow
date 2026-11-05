import { describe, expect, test } from "bun:test";

import type { FactoriesPage, FactoryCard } from "../../src/factories-page.ts";
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
	const app = await serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch({ [hubUrl]: answers }, requests),
		{
			env: { GITHUB_TOKEN: "recorded-token" },
			now: () => new Date(clockStart),
		},
	);
	return { ...app, requests };
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
				role: "box",
				hub: "work hub",
				state: "awake",
				reachable: true,
				slots: awake.slots,
				heartbeatAt: awake.last_contact,
			});
			expect(host?.cores).toBe(awake.snapshot?.cpu.cores);
			expect(cardOf(page, "spare-2")).toEqual({
				name: "spare-2",
				role: "box",
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
					role: "hub",
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
