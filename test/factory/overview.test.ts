import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../../src/domain.ts";
import type { FactoryEntry } from "../../src/factories.ts";
import hubCheckpoint from "../fixtures/factory-hub-checkpoint.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import { daemon, hub, hubUrl, laptopUrl } from "../support/factory.ts";
import { repo } from "../support/github.ts";
import { openEventStream, readWhere, settledRead } from "../support/reads.ts";
import {
	boxRow,
	factoryRunOf,
	hubWith41,
	overviewEventWhere,
	overviewWhere,
	progressAt,
	reportOf,
	reportTicket,
	type RunOverview,
	runPollMs,
	serveRuns,
} from "./_support.ts";

/** The hub runs, plus an older failed run of ticket 41 that a retry replaced. */
const hubRunsWithRetry = {
	runs: [
		...hubRuns.runs,
		{
			...hubRuns.runs[0],
			id: "20261025-100000-0000",
			status: { kind: "failed", reason: "stage review failed" },
			submitted_at: "2026-10-25T10:00:00+00:00",
			started_at: "2026-10-25T10:00:05+00:00",
			ended_at: "2026-10-25T10:40:00+00:00",
			machine: "box-b",
		},
	],
};

function hasTicket(body: RunOverview, number: number): boolean {
	return body.projects.some((project) =>
		project.tickets.some((view) => view.title === `Ticket ${number}`),
	);
}

function needsYouReasons(report: ProjectReport, number: number): string[] {
	return (
		report.sections.find((section) => section.id === "needsYou")?.needsYou ?? []
	)
		.filter((item) => item.key === `${repo}#${number}`)
		.map((item) => item.reason);
}

async function factoryEntries(base: string): Promise<FactoryEntry[]> {
	const response = await fetch(new URL("/api/settings", base));
	const body = (await response.json()) as { factoryEntries: FactoryEntry[] };
	return body.factoryEntries;
}

describe("factory runs", () => {
	test("a matched ticket in the overview carries its newest factory run", async () => {
		const app = await serveRuns(
			{ ...hub, "/runs": hubRunsWithRetry },
			[39, 41],
		);
		try {
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			expect(factoryRunOf(body, 41)).toEqual({
				id: "20261025-140102-a1b2",
				statusKind: "running",
				box: "box-a",
				factory: "work hub",
				source: "acme-github",
				rule: "ready-for-agent",
				startedAt: "2026-10-25T14:01:10+00:00",
				endedAt: null,
				coveredByFeed: true,
			});
			expect(factoryRunOf(body, 39)).toEqual({
				id: "20261025-120000-a7b8",
				statusKind: "failed",
				box: "box-a",
				factory: "work hub",
				source: "acme-github",
				rule: "ready-for-agent",
				startedAt: "2026-10-25T12:00:09+00:00",
				endedAt: "2026-10-25T12:30:00+00:00",
				coveredByFeed: true,
				result: "failed",
				resumable: true,
			});
		} finally {
			await app.stop();
		}
	});

	test("with a hub and a standalone daemon, each matched ticket carries its newest run with its stage, box and factory", async () => {
		const [running41] = hubRuns.runs;
		if (running41 === undefined) {
			throw new Error("the hub runs fixture lost a run");
		}
		const laptopRun = {
			...boxRow(running41, "running"),
			id: "20261025-141800-f7a8",
			ticket: "43",
		};
		const app = await serveRuns(
			hub,
			[41, 43],
			{
				41: progressAt("2026-10-25T14:10:00Z"),
				43: progressAt("2026-10-25T14:15:00Z"),
			},
			{ ...daemon, "/runs": { runs: [laptopRun] } },
		);
		try {
			const body = await overviewWhere(
				app.base,
				(seen) =>
					factoryRunOf(seen, 41) !== undefined &&
					factoryRunOf(seen, 43) !== undefined,
			);
			expect(factoryRunOf(body, 41)).toMatchObject({
				statusKind: "running",
				stage: "stage 3",
				box: "box-a",
				factory: "work hub",
				coveredByFeed: true,
			});
			expect(factoryRunOf(body, 43)).toMatchObject({
				id: "20261025-141800-f7a8",
				statusKind: "running",
				stage: "stage 3",
				box: "laptop",
				factory: "laptop",
				coveredByFeed: true,
			});
			expect(
				(await factoryEntries(app.base)).map((entry) => [
					entry.name,
					entry.kind,
					entry.alsoReadThroughHub,
				]),
			).toEqual([
				["work hub", "hub", undefined],
				["laptop", "daemon", undefined],
			]);
		} finally {
			await app.stop();
		}
	});

	test("the project report of a ticket with two runs carries its newest run and its earlier run", async () => {
		const app = await serveRuns(
			{ ...hub, "/runs": hubRunsWithRetry },
			[39, 41],
		);
		try {
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			const response = await fetch(
				new URL(`/api/projects/${encodeURIComponent(repo)}?view=all`, app.base),
			);
			const report = (await response.json()) as ProjectReport;
			const views = (number: number) =>
				report.tickets.find((view) => view.title === `Ticket ${number}`);
			expect(views(41)?.factoryRun).toMatchObject({
				statusKind: "running",
				startedAt: "2026-10-25T14:01:10+00:00",
			});
			expect(views(41)?.earlierFactoryRuns).toEqual([
				{
					statusKind: "failed",
					factory: "work hub",
					startedAt: "2026-10-25T10:00:05+00:00",
					endedAt: "2026-10-25T10:40:00+00:00",
					result: "failed",
				},
			]);
			expect(views(39)?.earlierFactoryRuns).toBeUndefined();
		} finally {
			await app.stop();
		}
	});

	test("the run filters of the saved project view keep the tickets with a matching run, and come back from the settings", async () => {
		const [running41] = hubRuns.runs;
		if (running41 === undefined) {
			throw new Error("the hub runs fixture lost a run");
		}
		const laptopRun = {
			...boxRow(running41, "running"),
			id: "20261025-141800-f7a8",
			ticket: "43",
		};
		const app = await serveRuns(
			{ ...hub, "/runs": hubRunsWithRetry },
			[38, 39, 40, 41, 42, 43],
			{},
			{ ...daemon, "/runs": { runs: [laptopRun] } },
		);
		try {
			await overviewWhere(
				app.base,
				(seen) =>
					factoryRunOf(seen, 41) !== undefined &&
					factoryRunOf(seen, 43) !== undefined,
			);
			const shownWith = async (runFilters: Record<string, unknown>) => {
				const current = (await (
					await fetch(new URL("/api/settings", app.base))
				).json()) as Record<string, unknown>;
				const saved = await fetch(new URL("/api/settings", app.base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: { [repo]: runFilters },
					}),
				});
				expect(saved.status).toBe(200);
				const report = await reportOf(app.base);
				return {
					tickets: report.tickets.map((view) => view.title),
					graph: report.graphTickets.map((view) => view.key),
					hiddenBy: report.hiddenBy,
				};
			};
			expect((await shownWith({})).tickets).toEqual([
				"Ticket 38",
				"Ticket 39",
				"Ticket 40",
				"Ticket 41",
				"Ticket 42",
				"Ticket 43",
			]);
			expect(await shownWith({ withRunsOnly: true })).toEqual({
				tickets: [
					"Ticket 39",
					"Ticket 40",
					"Ticket 41",
					"Ticket 42",
					"Ticket 43",
				],
				graph: [39, 40, 41, 42, 43].map((number) => `${repo}#${number}`),
				hiddenBy: undefined,
			});
			expect((await shownWith({ runStatuses: ["failed"] })).tickets).toEqual([
				"Ticket 39",
				"Ticket 41",
			]);
			expect((await shownWith({ runResults: ["noPr"] })).tickets).toEqual([
				"Ticket 40",
			]);
			expect(
				(
					await shownWith({
						runStatuses: ["running"],
						runFactories: ["Work Hub"],
					})
				).tickets,
			).toEqual(["Ticket 41"]);
			expect(
				(
					await shownWith({
						runStatuses: ["failed"],
						runFactories: ["laptop"],
					})
				).hiddenBy,
			).toEqual(["runStatuses", "runFactories"]);
			const filters = {
				withRunsOnly: true,
				runStatuses: ["running", "failed"],
				runResults: ["failed"],
				runFactories: ["work hub"],
			};
			expect((await shownWith(filters)).tickets).toEqual([
				"Ticket 39",
				"Ticket 41",
			]);
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as { projectViews: Record<string, Record<string, unknown>> };
			expect(settings.projectViews[repo]).toMatchObject(filters);
			const rejected = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...settings,
					projectViews: { [repo]: { runStatuses: ["done"] } },
				}),
			});
			expect(rejected.status).toBe(400);
		} finally {
			await app.stop();
		}
	});

	test("latest run only matches the run filters on the run that the card shows, and an older failed run matches without it", async () => {
		const app = await serveRuns(
			{ ...hub, "/runs": hubRunsWithRetry },
			[39, 41],
		);
		try {
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			const shownWith = async (runFilters: Record<string, unknown>) => {
				const current = (await (
					await fetch(new URL("/api/settings", app.base))
				).json()) as Record<string, unknown>;
				const saved = await fetch(new URL("/api/settings", app.base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: { [repo]: runFilters },
					}),
				});
				expect(saved.status).toBe(200);
				return (await reportOf(app.base)).tickets.map((view) => view.title);
			};
			expect(await shownWith({ runStatuses: ["failed"] })).toEqual([
				"Ticket 39",
				"Ticket 41",
			]);
			expect(
				await shownWith({ runStatuses: ["failed"], latestRunOnly: true }),
			).toEqual(["Ticket 39"]);
			expect(await shownWith({ latestRunOnly: true })).toEqual([
				"Ticket 39",
				"Ticket 41",
			]);
		} finally {
			await app.stop();
		}
	});

	test("advancing the clock past the run poll interval reads /runs again and sends the changed run", async () => {
		const app = await serveRuns(hub, [41]);
		const stream = openEventStream(app.base);
		try {
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
			);
			await stream.ready;
			const reads = app.runReads();
			const [running, ...rest] = hubRuns.runs;
			app.factories[hubUrl] = {
				...hub,
				"/runs": {
					runs: [{ ...running, status: { kind: "blocked" } }, ...rest],
				},
			};
			app.advance(runPollMs);
			const changed = await overviewEventWhere(
				stream.events,
				(seen) => factoryRunOf(seen, 41)?.statusKind === "blocked",
			);
			expect(factoryRunOf(changed, 41)).toMatchObject({
				statusKind: "blocked",
				coveredByFeed: true,
			});
			expect(app.runReads()).toBe(reads + 1);
		} finally {
			stream.close();
			await app.stop();
		}
	});

	test("a failed run can resume only while its ticket is open", async () => {
		const app = await serveRuns(hub, [39]);
		try {
			const open = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 39) !== undefined,
			);
			expect(factoryRunOf(open, 39)).toMatchObject({
				statusKind: "failed",
				resumable: true,
			});
			app.issues.closed.add(39);
			await fetch(new URL("/api/refresh", app.base), { method: "POST" });
			let done = reportTicket(await reportOf(app.base), 39);
			while (done.state !== "done") {
				await Bun.sleep(20);
				done = reportTicket(await reportOf(app.base), 39);
			}
			expect(done.factoryRun?.statusKind).toBe("failed");
			expect(done.factoryRun?.resumable).toBeUndefined();
		} finally {
			await app.stop();
		}
	});

	test("a run that matches no tracked ticket is kept and stays out of the overview", async () => {
		const app = await serveRuns(hub, [41]);
		try {
			const before = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			expect(hasTicket(before, 42)).toBe(false);
			expect(
				before.projects.flatMap((project) =>
					project.tickets.flatMap((view) =>
						view.factoryRun?.statusKind === "queued" ? [view] : [],
					),
				),
			).toEqual([]);
			const reads = app.runReads();
			app.issues.numbers = [41, 42];
			await fetch(new URL("/api/refresh", app.base), { method: "POST" });
			const after = await overviewWhere(app.base, (seen) =>
				hasTicket(seen, 42),
			);
			expect(factoryRunOf(after, 42)).toEqual({
				id: "20261025-141500-e5f6",
				statusKind: "queued",
				box: null,
				factory: "work hub",
				source: "acme-github",
				rule: "ready-for-agent",
				startedAt: null,
				endedAt: null,
				coveredByFeed: true,
			});
			expect(app.runReads()).toBe(reads);
		} finally {
			await app.stop();
		}
	});

	test("an unreachable factory clears the covered-by-feed flag of its runs", async () => {
		const app = await serveRuns(hub, [41]);
		const stream = openEventStream(app.base);
		try {
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.coveredByFeed === true,
			);
			await stream.ready;
			app.factories[hubUrl] = "down";
			app.advance(runPollMs);
			const changed = await overviewEventWhere(
				stream.events,
				(seen) => factoryRunOf(seen, 41)?.coveredByFeed === false,
			);
			expect(changed.factoryUnreachable).toBe(true);
			expect(factoryRunOf(changed, 41)).toMatchObject({
				statusKind: "running",
				coveredByFeed: false,
			});
			expect(
				reportTicket(await reportOf(app.base), 41).factoryRun,
			).toMatchObject({ statusKind: "running", coveredByFeed: false });
		} finally {
			stream.close();
			await app.stop();
		}
	});

	describe("the feed wins over comment evidence", () => {
		test("a failed factory run gives Run failed and Needs you, while the progress comment shows the run as live", async () => {
			const app = await serveRuns(hub, [39], {
				39: progressAt("2026-10-25T14:10:00Z"),
			});
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 39) !== undefined,
				);
				const report = await reportOf(app.base);
				expect(reportTicket(report, 39)).toMatchObject({
					state: "backlog",
					chips: ["Run failed"],
					run: { status: "failed", stage: "stage 3" },
				});
				expect(needsYouReasons(report, 39)).toEqual(["runFailed"]);
			} finally {
				await app.stop();
			}
		});

		test("a blocked factory run gives an open ask in Needs you, while the progress comment shows the run as live", async () => {
			const app = await serveRuns(hubWith41("blocked"), [41], {
				41: progressAt("2026-10-25T14:10:00Z"),
			});
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				expect(needsYouReasons(await reportOf(app.base), 41)).toEqual(["ask"]);
			} finally {
				await app.stop();
			}
		});

		test("a running factory run gives In progress, while the tracker status is a not-started state", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const report = await reportOf(app.base);
				expect(reportTicket(report, 41)).toMatchObject({
					state: "inProgress",
					statusType: "inProgress",
				});
				expect(needsYouReasons(report, 41)).toEqual([]);
			} finally {
				await app.stop();
			}
		});

		test("a running factory run whose progress comment is older than the stall limit does not give Run failed", async () => {
			const app = await serveRuns(hub, [41], {
				41: progressAt("2026-10-25T12:00:00Z"),
			});
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const report = await reportOf(app.base);
				const shown = reportTicket(report, 41);
				expect(shown).toMatchObject({
					state: "inProgress",
					run: { status: "running", stage: "stage 3" },
				});
				expect(shown.chips ?? []).not.toContain("Run failed");
				expect(needsYouReasons(report, 41)).toEqual([]);
			} finally {
				await app.stop();
			}
		});

		test("a ticket with no factory run keeps its current state and needs-you result", async () => {
			const app = await serveRuns(hub, [41, 43, 44], {
				43: progressAt("2026-10-25T12:00:00Z"),
				44: progressAt("2026-10-25T14:10:00Z"),
			});
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const report = await reportOf(app.base);
				expect(reportTicket(report, 43)).toMatchObject({
					state: "backlog",
					chips: ["Run failed"],
					run: { status: "failed", stage: "stage 3" },
				});
				expect(needsYouReasons(report, 43)).toEqual(["runFailed"]);
				expect(reportTicket(report, 44)).toMatchObject({
					state: "inProgress",
					run: { status: "running", stage: "stage 3" },
				});
				expect(needsYouReasons(report, 44)).toEqual([]);
			} finally {
				await app.stop();
			}
		});
	});

	describe("a hub and its box report the same run", () => {
		const [running41, , queued42] = hubRuns.runs;
		if (running41 === undefined || queued42 === undefined) {
			throw new Error("the hub runs fixture lost a run");
		}

		test("the run shows once, with the box status and the hub source and rule", async () => {
			const app = await serveRuns(
				hub,
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(running41, "blocked")] },
				},
			);
			try {
				const body = await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect(factoryRunOf(body, 41)).toEqual({
					id: "20261025-140102-a1b2",
					statusKind: "blocked",
					box: "laptop",
					factory: "laptop",
					source: "acme-github",
					rule: "ready-for-agent",
					startedAt: "2026-10-25T14:01:10+00:00",
					endedAt: null,
					coveredByFeed: true,
					resumable: true,
				});
			} finally {
				await app.stop();
			}
		});

		test("settings warns on the box entry that the hub also reads its runs", async () => {
			const app = await serveRuns(
				hub,
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(running41, "running")] },
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				const entries = await factoryEntries(app.base);
				expect(
					entries.map((entry) => [entry.name, entry.alsoReadThroughHub]),
				).toEqual([
					["work hub", undefined],
					["laptop", "work hub"],
				]);
			} finally {
				await app.stop();
			}
		});

		test("a queued run that the box accepts shows as running and not as ended", async () => {
			const app = await serveRuns(hub, [42], {}, daemon);
			const stream = openEventStream(app.base);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 42)?.statusKind === "queued",
				);
				await stream.ready;
				const accepted = {
					...queued42,
					id: "20261025-141530-b9c0",
					status: { kind: "running", reason: null },
					started_at: "2026-10-25T14:15:30+00:00",
					machine: "laptop",
				};
				app.factories[hubUrl] = {
					...hub,
					"/runs": {
						runs: hubRuns.runs.map((row) =>
							row === queued42 ? accepted : row,
						),
					},
				};
				app.factories[laptopUrl] = {
					...daemon,
					"/runs": { runs: [boxRow(accepted, "running")] },
				};
				app.advance(runPollMs);
				const changed = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 42)?.statusKind !== "queued",
				);
				expect(factoryRunOf(changed, 42)).toEqual({
					id: "20261025-141530-b9c0",
					statusKind: "running",
					box: "laptop",
					factory: "laptop",
					source: "acme-github",
					rule: "ready-for-agent",
					startedAt: "2026-10-25T14:15:30+00:00",
					endedAt: null,
					coveredByFeed: true,
				});
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("an unreachable box gives the run the hub status, and the box row comes back with the box", async () => {
			const checkpointPath = `/runs/${running41.id}/checkpoint`;
			const boxAnswers = {
				...daemon,
				"/runs": { runs: [boxRow(running41, "blocked")] },
				[checkpointPath]: hubCheckpoint,
			};
			const checkpointOf = () =>
				settledRead(
					new URL(
						`/api/factory-runs/${encodeURIComponent(running41.id)}/checkpoint`,
						app.base,
					),
				);
			const app = await serveRuns(hub, [41], {}, boxAnswers);
			const stream = openEventStream(app.base);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				await stream.ready;
				app.factories[laptopUrl] = "down";
				app.advance(runPollMs);
				const down = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.factory === "work hub",
				);
				expect(factoryRunOf(down, 41)).toMatchObject({
					statusKind: "running",
					box: "box-a",
					factory: "work hub",
					coveredByFeed: true,
				});
				expect((await checkpointOf()).status).toBe(404);
				app.factories[laptopUrl] = boxAnswers;
				app.advance(runPollMs);
				const back = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect(factoryRunOf(back, 41)).toMatchObject({
					statusKind: "blocked",
					box: "laptop",
					factory: "laptop",
					coveredByFeed: true,
				});
				const checkpoint = await readWhere<{ stage?: string }>(
					new URL(
						`/api/factory-runs/${encodeURIComponent(running41.id)}/checkpoint`,
						app.base,
					),
					(body) => body.stage !== undefined,
				);
				expect(checkpoint).toMatchObject({ stage: "review" });
			} finally {
				stream.close();
				await app.stop();
			}
		});
	});
});
