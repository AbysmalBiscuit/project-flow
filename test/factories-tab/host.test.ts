import { describe, expect, test } from "bun:test";

import type { FactoriesPage, FactoryCard } from "../../src/factories-page.ts";
import machine from "../fixtures/factory-machine.json";
import { insightQuery } from "../insights/_support.ts";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hubUrl,
	laptopUrl,
	serve,
} from "../support/factory.ts";
import {
	clockStart,
	factoriesWhere,
	hubAbout,
	laptopAbout,
} from "./_support.ts";

const hourMs = 60 * 60 * 1_000;
const [rootDisk] = machine.disks;
if (rootDisk === undefined) {
	throw new Error("the host fixture lost its disk");
}
const gigabyte = 1_000_000_000;

type Snapshot = typeof machine;

/** The recorded snapshot with the parts that `change` sets. */
function snapshot(change: (recorded: Snapshot) => Snapshot): Snapshot {
	return change(structuredClone(machine));
}

async function serveHosts(
	factories: { name: string; url: string; placementGate?: number }[],
	answers: Record<string, Answers>,
	now: () => Date = () => new Date(clockStart),
) {
	const requests: FactoryRequest[] = [];
	return serve([], { factories }, factoryFetch(answers, requests), {
		env: { GITHUB_TOKEN: "recorded-token" },
		now,
	});
}

const cardOf = (page: FactoriesPage, name: string): FactoryCard | undefined =>
	page.boxes.find((box) => box.name === name);

const hubAnswers = (machineAnswer: unknown): Answers => ({
	"/daemon": hubAbout,
	"/sources": { sources: [] },
	"/runs": { runs: [] },
	"/machine": machineAnswer,
});

const laptopAnswers = (machineAnswer: unknown): Answers => ({
	"/daemon": laptopAbout,
	"/runs": { runs: [] },
	"/machine": machineAnswer,
});

describe("the host health of the box cards", () => {
	test("a recorded host answer gives the load, memory, swap and disk values with the colour of each metric", async () => {
		const strained = snapshot((recorded) => ({
			...recorded,
			cpu: { ...recorded.cpu, load_5m: 17, busy_percent: 80 },
			memory: { ...recorded.memory, available_bytes: 3 * gigabyte },
			disks: recorded.disks.map((disk) => ({
				...disk,
				used_bytes: disk.total_bytes - 10 * gigabyte,
				free_bytes: 10 * gigabyte,
			})),
		}));
		const app = await serveHosts(
			[
				{ name: "work hub", url: hubUrl },
				{ name: "laptop", url: laptopUrl },
			],
			{ [hubUrl]: hubAnswers(machine), [laptopUrl]: laptopAnswers(strained) },
		);
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) =>
					cardOf(seen, "work hub")?.host !== undefined &&
					cardOf(seen, "laptop")?.host !== undefined,
			);
			expect(cardOf(page, "work hub")?.host).toEqual({
				takenAt: machine.taken_at,
				uptimeS: machine.uptime_seconds,
				cores: 16,
				level: "warn",
				worst: { metric: "swap" },
				load: {
					m1: machine.cpu.load_1m,
					m5: machine.cpu.load_5m,
					m15: machine.cpu.load_15m,
					perCore: machine.cpu.load_5m / 16,
					gate: null,
					hour: [machine.cpu.load_1m],
					level: "ok",
				},
				cpu: { busyPercent: 29.2, iowaitPercent: 0, level: "ok" },
				memory: {
					totalBytes: machine.memory.total_bytes,
					availableBytes: machine.memory.available_bytes,
					level: "ok",
				},
				swap: {
					totalBytes: machine.memory.swap_total_bytes,
					usedBytes: machine.memory.swap_used_bytes,
					level: "warn",
				},
				disks: [
					{
						mount: "/",
						holds: ["runs", "store", "worktrees"],
						totalBytes: rootDisk.total_bytes,
						usedBytes: rootDisk.used_bytes,
						freeBytes: rootDisk.free_bytes,
						fullInS: null,
						level: "ok",
					},
				],
			});
			const laptop = cardOf(page, "laptop")?.host;
			expect({
				level: laptop?.level,
				worst: laptop?.worst,
				load: laptop?.load.level,
				cpu: laptop?.cpu.level,
				memory: laptop?.memory.level,
				swap: laptop?.swap.level,
				disks: laptop?.disks.map((disk) => disk.level),
			}).toEqual({
				level: "bad",
				worst: { metric: "load" },
				load: "bad",
				cpu: "warn",
				memory: "bad",
				swap: "warn",
				disks: ["bad"],
			});
		} finally {
			await app.stop();
		}
	});

	test("host samples over 6 hours give the time until full of a growing mount, and no growth for a flat mount", async () => {
		let now = Date.parse(clockStart);
		const growing = (hours: number) =>
			snapshot((recorded) => ({
				...recorded,
				disks: [
					{
						mount: "/",
						holds: ["store"],
						total_bytes: 100 * gigabyte,
						used_bytes: 50 * gigabyte,
						free_bytes: 50 * gigabyte,
					},
					{
						mount: "/srv/runs",
						holds: ["runs"],
						total_bytes: 100 * gigabyte,
						used_bytes: (74 + hours) * gigabyte,
						free_bytes: (26 - hours) * gigabyte,
					},
				],
			}));
		const app = await serveHosts(
			[{ name: "work hub", url: hubUrl }],
			{
				[hubUrl]: hubAnswers(() =>
					growing((now - Date.parse(clockStart)) / hourMs),
				),
			},
			() => new Date(now),
		);
		try {
			let page: FactoriesPage | undefined;
			for (let hours = 0; hours <= 6; hours += 1) {
				now = Date.parse(clockStart) + hours * hourMs;
				page = await factoriesWhere(
					app.base,
					(seen) =>
						cardOf(seen, "work hub")?.host?.disks[1]?.usedBytes ===
						(74 + hours) * gigabyte,
				);
			}
			const disks =
				page === undefined ? [] : cardOf(page, "work hub")?.host?.disks;
			expect(
				disks?.map(({ mount, fullInS, level }) => ({ mount, fullInS, level })),
			).toEqual([
				{ mount: "/", fullInS: null, level: "ok" },
				{ mount: "/srv/runs", fullInS: 20 * 60 * 60, level: "warn" },
			]);
		} finally {
			await app.stop();
		}
	});

	test("a placement gate in the configuration turns the card amber at the gate", async () => {
		const calm = snapshot((recorded) => ({
			...recorded,
			memory: { ...recorded.memory, swap_used_bytes: 0 },
		}));
		const app = await serveHosts(
			[
				{ name: "work hub", url: hubUrl, placementGate: 8 },
				{ name: "laptop", url: laptopUrl, placementGate: 12 },
			],
			{ [hubUrl]: hubAnswers(calm), [laptopUrl]: laptopAnswers(calm) },
		);
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) =>
					cardOf(seen, "work hub")?.host !== undefined &&
					cardOf(seen, "laptop")?.host !== undefined,
			);
			const hub = cardOf(page, "work hub")?.host;
			expect({
				level: hub?.level,
				worst: hub?.worst,
				gate: hub?.load.gate,
				load: hub?.load.level,
			}).toEqual({
				level: "warn",
				worst: { metric: "gate" },
				gate: 8,
				load: "ok",
			});
			const laptop = cardOf(page, "laptop")?.host;
			expect({ level: laptop?.level, gate: laptop?.load.gate }).toEqual({
				level: "ok",
				gate: 12,
			});
			expect(laptop?.worst).toBeUndefined();
		} finally {
			await app.stop();
		}
	});

	test("the run history removes host samples older than 24 hours", async () => {
		let now = Date.parse(clockStart);
		const app = await serveHosts(
			[{ name: "work hub", url: hubUrl }],
			{ [hubUrl]: hubAnswers(machine) },
			() => new Date(now),
		);
		const samples = async () => {
			const { body } = await insightQuery(
				app.base,
				"select factory, at from host_samples order by at",
			);
			return "rows" in body ? body.rows : [];
		};
		try {
			while ((await samples()).length === 0) {
				await Bun.sleep(20);
			}
			now = Date.parse(clockStart) + 25 * hourMs;
			const later = new Date(now).toISOString();
			while ((await samples()).at(-1)?.[1] !== later) {
				await Bun.sleep(20);
			}
			expect(await samples()).toEqual([["work hub", later]]);
		} finally {
			await app.stop();
		}
	});

	test("a host route that stops giving samples leaves no old meters on the card", async () => {
		let now = Date.parse(clockStart);
		let failing = false;
		const app = await serveHosts(
			[{ name: "work hub", url: hubUrl }],
			{
				[hubUrl]: hubAnswers(() =>
					failing
						? new Response("cannot read the machine state", { status: 500 })
						: machine,
				),
			},
			() => new Date(now),
		);
		try {
			await factoriesWhere(
				app.base,
				(seen) => cardOf(seen, "work hub")?.host !== undefined,
			);
			failing = true;
			now = Date.parse(clockStart) + 2 * 60 * 1_000;
			const page = await factoriesWhere(
				app.base,
				(seen) =>
					cardOf(seen, "work hub")?.heartbeatAt === new Date(now).toISOString(),
			);
			expect(cardOf(page, "work hub")?.host).toBeUndefined();
			expect(cardOf(page, "work hub")?.reachable).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a factory with no host route gets the not served note and no meters", async () => {
		const app = await serveHosts(
			[
				{ name: "work hub", url: hubUrl },
				{ name: "laptop", url: laptopUrl },
			],
			{ [hubUrl]: hubAnswers(machine), [laptopUrl]: laptopAnswers(null) },
		);
		try {
			const page = await factoriesWhere(app.base, (seen) =>
				seen.notServed.some((panel) => panel.panel === "host"),
			);
			expect(page.notServed).toEqual([
				{ factory: "laptop", panel: "host", route: "GET /machine" },
			]);
			expect(cardOf(page, "laptop")?.host).toBeUndefined();
		} finally {
			await app.stop();
		}
	});
});
