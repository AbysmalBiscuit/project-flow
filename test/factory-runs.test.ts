import { describe, expect, test } from "bun:test";

import type {
	NeedsYouItem,
	ProjectReport,
	RunCheckpoint,
	RunDetail,
	ShownFactoryRun,
	TicketView,
} from "../src/domain.ts";
import type { FactoryEntry } from "../src/factories.ts";
import type { Fetch } from "../src/fetch.ts";
import type { RunListRow } from "../src/run-list.ts";
import {
	type Answers,
	daemon,
	EventFeed,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	json,
	laptopSocket,
	laptopUrl,
	readOrRunWrite,
	serve,
} from "./factory-support.ts";
import hubCheckpoint from "./fixtures/factory-hub-checkpoint.json";
import hubEvents from "./fixtures/factory-hub-events.json";
import hubRuns from "./fixtures/factory-hub-runs.json";
import runArtifact from "./fixtures/factory-run-artifact.json";
import runArtifacts from "./fixtures/factory-run-artifacts.json";
import runDetail from "./fixtures/factory-run-detail.json";
import runEvents from "./fixtures/factory-run-events.json";
import runGraphCheckpoint from "./fixtures/factory-run-graph-checkpoint.json";
import runGraph from "./fixtures/factory-run-graph.json";
import answeredQuestions from "./fixtures/factory-run-questions-answered.json";
import runQuestions from "./fixtures/factory-run-questions.json";
import runSandbox from "./fixtures/factory-run-sandbox.json";
import runTurns from "./fixtures/factory-run-turns.json";
import runWorkers from "./fixtures/factory-run-workers.json";
import steerDelivered from "./fixtures/factory-steer-delivered.json";
import {
	issuesResponse,
	listedRead,
	openEventStream,
	page,
	recordedOrEmpty,
	repo,
	ticket,
} from "./live-support.ts";
import { pull } from "./review-support.ts";
import {
	githubPullNode,
	readWhere,
	recordedDiscovery,
	settledRead,
	unrecorded,
	urlOf,
} from "./support.ts";

type RunOverview = {
	projects: { tickets: TicketView[] }[];
	polling?: true;
	factoryUnreachable?: true;
};

const runClockStart = Date.parse("2026-10-25T14:20:00Z");

const runPollMs = 10_000;

const streamRetryMs = 10_000;

const streamedRunPollMs = 60_000;

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

function factoryRunOf(
	body: RunOverview,
	number: number,
): ShownFactoryRun | undefined {
	return body.projects
		.flatMap((project) => project.tickets)
		.find((view) => view.title === `Ticket ${number}`)?.factoryRun;
}

function hasTicket(body: RunOverview, number: number): boolean {
	return body.projects.some((project) =>
		project.tickets.some((view) => view.title === `Ticket ${number}`),
	);
}

async function overviewWhere(
	base: string,
	accept: (body: RunOverview) => boolean,
): Promise<RunOverview> {
	while (true) {
		const response = await fetch(new URL("/api/overview", base));
		const body = (await response.json()) as RunOverview;
		if (body.polling !== true && accept(body)) {
			return body;
		}
		await Bun.sleep(20);
	}
}

async function overviewEventWhere(
	events: AsyncIterable<{ event: string; data: string }>,
	accept: (body: RunOverview) => boolean,
): Promise<RunOverview> {
	for await (const event of events) {
		if (event.event !== "overview") {
			continue;
		}
		const body = JSON.parse(event.data) as RunOverview;
		if (accept(body)) {
			return body;
		}
	}
	throw new Error("the event stream ended before the overview changed");
}

async function reportOf(base: string): Promise<ProjectReport> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectReport;
}

function reportTicket(report: ProjectReport, number: number): TicketView {
	const found = report.tickets.find((view) => view.key === `${repo}#${number}`);
	if (found === undefined) {
		throw new Error(`ticket ${number} is missing from the project`);
	}
	return found;
}

function needsYouReasons(report: ProjectReport, number: number): string[] {
	return (
		report.sections.find((section) => section.id === "needsYou")?.needsYou ?? []
	)
		.filter((item) => item.key === `${repo}#${number}`)
		.map((item) => item.reason);
}

/** A progress comment at stage 3, last updated at `updatedAt`. */
function progressAt(updatedAt: string): Record<string, unknown>[] {
	return [
		{
			id: 1,
			body: "**Workcell progress**\n\n- stage 3: writing the change",
			user: { login: "lev" },
			created_at: "2026-10-25T09:30:00Z",
			updated_at: updatedAt,
		},
	];
}

/** The hub runs, with the run of ticket 41 set to `kind`. */
function hubWith41(kind: string): Answers {
	const [running, ...rest] = hubRuns.runs;
	return {
		...hub,
		"/runs": { runs: [{ ...running, status: { kind } }, ...rest] },
	};
}

/** A run row as the box `laptop` reports it: no source, and `machine` is `local`. */
function boxRow(hubRow: (typeof hubRuns.runs)[number], kind: string) {
	return {
		...hubRow,
		status: { kind, reason: null },
		source: null,
		rule: null,
		machine: "local",
	};
}

async function factoryEntries(base: string): Promise<FactoryEntry[]> {
	const response = await fetch(new URL("/api/settings", base));
	const body = (await response.json()) as { factoryEntries: FactoryEntry[] };
	return body.factoryEntries;
}

/**
 * A hub, and its box when `boxAnswers` is given, with a tracked repo whose issues
 * the test can change, on a clock the test advances.
 */
async function serveRuns(
	hubAnswers: Answers,
	issueNumbers: number[],
	comments: Record<number, Record<string, unknown>[]> = {},
	boxAnswers?: Answers,
	pulls: Record<string, unknown>[] = [],
	mergedPulls: Record<string, unknown>[] = [],
) {
	const factories: Record<string, Answers | "down"> = {
		[hubUrl]: hubAnswers,
		...(boxAnswers === undefined ? {} : { [laptopUrl]: boxAnswers }),
	};
	const requests: FactoryRequest[] = [];
	const issues = { numbers: issueNumbers };
	let now = runClockStart;
	const tracker: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		if (listedRead(input, init)?.repo === repo) {
			return (
				issuesResponse(
					input,
					init,
					issues.numbers.map((number) => {
						const rows = comments[number];
						return {
							...ticket(number, "2026-10-25T09:00:00Z"),
							...(rows === undefined ? {} : { commentRows: rows }),
						};
					}),
					repo,
					pulls,
					mergedPulls,
				) ?? page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input, init);
	};
	const app = await serve(
		[],
		{
			pinned: [{ tracker: "github", repo }],
			factories: [
				{ name: "work hub", url: hubUrl },
				...(boxAnswers === undefined
					? []
					: [{ name: "laptop", url: laptopUrl }]),
			],
		},
		factoryFetch(factories, requests, tracker),
		{ env: { GITHUB_TOKEN: "recorded-token" }, now: () => new Date(now) },
	);
	return {
		...app,
		stop: async () => {
			await app.stop();
			expect(requests.filter((request) => !readOrRunWrite(request))).toEqual(
				[],
			);
		},
		factories,
		issues,
		requests,
		runReads: () =>
			requests.filter((request) => request.url === `${hubUrl}/runs`).length,
		eventReads: () =>
			requests.filter((request) => request.url === `${hubUrl}/events`).length,
		advance: (ms: number) => {
			now += ms;
		},
	};
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

	describe("the hub event stream", () => {
		test("stage frames update the run stage and reach /api/events with no run poll request", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, "/events": feed }, [41], {
				41: progressAt("2026-10-25T14:10:00Z"),
			});
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				// The first run poll and the connect snapshot each read /runs.
				while (app.runReads() < 2) {
					await Bun.sleep(10);
				}
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				const reads = app.runReads();
				const [planStarted, planCompleted, buildStarted] = hubEvents;
				feed.send(planStarted);
				const planning = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.stage === "plan",
				);
				expect(factoryRunOf(planning, 41)).toMatchObject({
					statusKind: "running",
					stage: "plan",
				});
				feed.send(planCompleted);
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.stage === undefined,
				);
				feed.send(buildStarted);
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.stage === "build",
				);
				expect(reportTicket(await reportOf(app.base), 41).run).toEqual({
					status: "running",
					stage: "build",
				});
				expect(app.runReads()).toBe(reads);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("a closed stream waits, then reconnects and reads a fresh /runs snapshot", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, "/events": feed }, [41]);
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				// The first run poll and the connect snapshot each read /runs.
				while (app.runReads() < 2) {
					await Bun.sleep(10);
				}
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				const reads = app.runReads();
				app.factories[hubUrl] = { ...hubWith41("blocked"), "/events": feed };
				app.advance(streamRetryMs / 2);
				feed.drop();
				// One turn of the event loop lets the app see the close at this clock time.
				await Bun.sleep(0);
				app.advance(streamRetryMs / 2);
				// The run poll reads /runs of the hub only once its stream is closed.
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "blocked",
				);
				expect(app.runReads()).toBe(reads + 1);
				expect(app.eventReads()).toBe(1);
				app.factories[hubUrl] = { ...hubWith41("running"), "/events": feed };
				app.advance(streamRetryMs / 2);
				await feed.connected(2);
				const changed = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				expect(factoryRunOf(changed, 41)?.coveredByFeed).toBe(true);
				expect(app.eventReads()).toBe(2);
				expect(app.runReads()).toBe(reads + 2);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("an open stream keeps a slow /runs read that shows a run the hub queues", async () => {
			const feed = new EventFeed();
			const [running41, , queued42] = hubRuns.runs;
			const app = await serveRuns(
				{ ...hub, "/runs": { runs: [running41] }, "/events": feed },
				[41, 42],
			);
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				app.factories[hubUrl] = {
					...hub,
					"/runs": { runs: [running41, queued42] },
					"/events": feed,
				};
				app.advance(streamedRunPollMs);
				const changed = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 42) !== undefined,
				);
				expect(factoryRunOf(changed, 42)).toMatchObject({
					statusKind: "queued",
					coveredByFeed: true,
				});
				expect(app.eventReads()).toBe(1);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("a streamed run gets its start time and its end time from the slow /runs read", async () => {
			const feed = new EventFeed();
			const [, , queued42] = hubRuns.runs;
			if (queued42 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const hubWith42 = (row: Record<string, unknown>): Answers => ({
				...hub,
				"/runs": { runs: [{ ...queued42, ...row }] },
				"/events": feed,
			});
			const app = await serveRuns(hubWith42({}), [42]);
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 42)?.statusKind === "queued",
				);
				await stream.ready;
				const startedAt = "2026-10-25T14:16:00+00:00";
				app.factories[hubUrl] = hubWith42({
					status: { kind: "running", reason: null },
					started_at: startedAt,
					machine: "box-a",
				});
				feed.send({ run_id: queued42.id, status: { kind: "running" } });
				app.advance(streamedRunPollMs);
				const started = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 42)?.startedAt === startedAt,
				);
				expect(factoryRunOf(started, 42)).toMatchObject({
					statusKind: "running",
					endedAt: null,
				});
				const endedAt = "2026-10-25T14:40:00+00:00";
				app.factories[hubUrl] = hubWith42({
					status: { kind: "succeeded", reason: null },
					started_at: startedAt,
					ended_at: endedAt,
					machine: "box-a",
				});
				feed.send({ run_id: queued42.id, status: { kind: "succeeded" } });
				app.advance(streamedRunPollMs);
				const ended = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 42)?.endedAt === endedAt,
				);
				expect(factoryRunOf(ended, 42)).toMatchObject({
					statusKind: "succeeded",
					startedAt,
				});
				expect(app.eventReads()).toBe(1);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("a factory that answers 404 on /events keeps the run poll", async () => {
			const app = await serveRuns(hub, [41]);
			const stream = openEventStream(app.base);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				while (app.eventReads() === 0) {
					await Bun.sleep(10);
				}
				const reads = app.runReads();
				app.factories[hubUrl] = hubWith41("blocked");
				app.advance(runPollMs);
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "blocked",
				);
				expect(app.runReads()).toBe(reads + 1);
				expect(app.eventReads()).toBe(1);
			} finally {
				stream.close();
				await app.stop();
			}
		});
	});

	describe("the run checkpoint", () => {
		const checkpointPath = `/runs/${hubRuns.runs[0]?.id}/checkpoint`;

		async function checkpointOf(base: string): Promise<Response> {
			const body = await overviewWhere(
				base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			const id = factoryRunOf(body, 41)?.id ?? "";
			return settledRead(
				new URL(`/api/factory-runs/${encodeURIComponent(id)}/checkpoint`, base),
			);
		}

		test("the ticket's run carries the current stage, completed stages, retries and visits of its recorded checkpoint, and no graph from a factory that serves none", async () => {
			const app = await serveRuns(
				{ ...hub, [checkpointPath]: hubCheckpoint },
				[41],
			);
			try {
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					stage: "review",
					completedStages: ["start", "plan", "build", "review", "build"],
					retries: { build: 1 },
					visits: { start: 1, plan: 1, build: 2, review: 2 },
					usageNotServed: true,
					graph: null,
				});
			} finally {
				await app.stop();
			}
		});

		test("the run carries the nodes and edges of its recorded graph, with the shape of each node, the condition of each edge and the state of each node from the checkpoint", async () => {
			const graphPath = `/runs/${hubRuns.runs[0]?.id}/graph`;
			const app = await serveRuns(
				{
					...hub,
					[checkpointPath]: {
						...runGraphCheckpoint,
						node_retries: { push: 1 },
					},
					[graphPath]: runGraph,
				},
				[41],
			);
			try {
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(200);
				const { stage, graph } = (await response.json()) as RunCheckpoint;
				expect(stage).toBe("post_pr/post_pr");
				expect(graph?.nodes.map((node) => node.id)).toEqual(
					runGraph.nodes.map((node) => node.id),
				);
				const nodeOf = (id: string) =>
					graph?.nodes.find((node) => node.id === id);
				expect(nodeOf("post_pr")).toEqual({
					id: "post_pr",
					label: "Post PR",
					shape: "box",
					kind: "codergen",
					state: "current",
					visits: 0,
					retries: 0,
					child: [
						{
							id: "post_pr/start",
							label: "start",
							state: "completed",
							visits: 1,
							retries: 0,
						},
						{
							id: "post_pr/draft_pr",
							label: "draft_pr",
							state: "completed",
							visits: 1,
							retries: 0,
						},
						{
							id: "post_pr/post_pr",
							label: "post_pr",
							state: "current",
							visits: 2,
							retries: 0,
						},
					],
				});
				expect(nodeOf("report")).toMatchObject({ child: [] });
				expect(
					Object.fromEntries(
						(graph?.nodes ?? []).map((node) => [node.shape, node.kind]),
					),
				).toEqual({
					Mdiamond: "start",
					Msquare: "exit",
					parallelogram: "tool",
					hexagon: "wait.human",
					box: "codergen",
					component: "parallel",
					tripleoctagon: "parallel.fan_in",
				});
				expect(nodeOf("fan")).toMatchObject({ visits: 2 });
				expect(nodeOf("review")).toMatchObject({ state: "completed" });
				expect(nodeOf("push")).toMatchObject({
					state: "completed",
					retries: 1,
				});
				expect(nodeOf("report")).toMatchObject({ state: "ahead" });
				expect(nodeOf("exit")).toMatchObject({ state: "ahead" });
				expect(graph?.edges).toHaveLength(runGraph.edges.length);
				expect(graph?.edges).toContainEqual({
					from: "push",
					to: "fan",
					label: "pushed",
					condition: "outcome=success",
				});
				expect(graph?.edges).toContainEqual({
					from: "handoff_operator",
					to: "handoff_operator",
					label: "remind",
					condition: "preferred_label=remind",
				});
				expect(graph?.edges).toContainEqual({
					from: "join",
					to: "check",
					condition: "context.through!=implement",
				});
				expect(graph?.edges).toContainEqual({ from: "fan", to: "verify" });
			} finally {
				await app.stop();
			}
		});

		test("a failed checkpoint marks the stage where the run failed", async () => {
			const graphPath = `/runs/${hubRuns.runs[0]?.id}/graph`;
			const app = await serveRuns(
				{
					...hub,
					[checkpointPath]: { ...runGraphCheckpoint, status: "fail" },
					[graphPath]: runGraph,
				},
				[41],
			);
			try {
				const { graph } = (await (
					await checkpointOf(app.base)
				).json()) as RunCheckpoint;
				const postPr = graph?.nodes.find((node) => node.id === "post_pr");
				expect(postPr?.state).toBe("failed");
				expect(postPr?.child?.at(-1)).toMatchObject({
					id: "post_pr/post_pr",
					state: "failed",
				});
			} finally {
				await app.stop();
			}
		});

		test("a run that the hub and its box report reads the checkpoint of the box", async () => {
			const [running41] = hubRuns.runs;
			if (running41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				hub,
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(running41, "running")] },
					[checkpointPath]: hubCheckpoint,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toMatchObject({ stage: "review" });
			} finally {
				await app.stop();
			}
		});

		test("a run whose factory answers the checkpoint read with 404 reports it as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		describe("the run usage", () => {
			const turnsPath = `/runs/${hubRuns.runs[0]?.id}/turns`;

			test("the run checkpoint read gives the tokens, cost, time and tool counts of each stage and of the run from its recorded turns", async () => {
				const app = await serveRuns(
					{ ...hub, [checkpointPath]: hubCheckpoint, [turnsPath]: runTurns },
					[41],
				);
				try {
					const response = await checkpointOf(app.base);
					expect(response.status).toBe(200);
					const detail = (await response.json()) as RunCheckpoint;
					expect(detail.usage).toEqual({
						stages: {
							plan: {
								inputTokens: 41200,
								outputTokens: 1830,
								costUsd: 0.3125,
								durationS: 94.5,
								tools: { Read: 6, Bash: 2 },
							},
							build: {
								inputTokens: 245500,
								outputTokens: 12570,
								costUsd: 2,
								durationS: 813.5,
								tools: { Read: 11, Edit: 10, Bash: 13 },
							},
							review: {
								inputTokens: 24000,
								outputTokens: 700,
								costUsd: 0,
								durationS: 48,
								tools: { command_execution: 3 },
							},
						},
						total: {
							inputTokens: 310700,
							outputTokens: 15100,
							costUsd: 2.3125,
							durationS: 956,
							tools: { Read: 17, Bash: 15, Edit: 10, command_execution: 3 },
						},
					});
				} finally {
					await app.stop();
				}
			});

			test("a run that only the hub reports reads its turns from the hub", async () => {
				const app = await serveRuns(
					{ ...hub, [checkpointPath]: hubCheckpoint, [turnsPath]: runTurns },
					[41],
				);
				try {
					const detail = (await (
						await checkpointOf(app.base)
					).json()) as RunCheckpoint;
					expect(detail.usage?.total.costUsd).toBe(2.3125);
					expect(
						new Set(
							app.requests
								.filter((request) => request.url.endsWith("/turns"))
								.map((request) => request.url),
						),
					).toEqual(new Set([`${hubUrl}${turnsPath}`]));
				} finally {
					await app.stop();
				}
			});

			test("a factory that answers the turns read with 404 gives the run checkpoint with no usage, and reports the usage as not served", async () => {
				const app = await serveRuns(
					{ ...hub, [checkpointPath]: hubCheckpoint },
					[41],
				);
				try {
					const response = await checkpointOf(app.base);
					expect(response.status).toBe(200);
					const detail = (await response.json()) as RunCheckpoint;
					expect(detail.stage).toBe("review");
					expect(detail).not.toHaveProperty("usage");
					expect(detail.usageNotServed).toBe(true);
				} finally {
					await app.stop();
				}
			});
		});
	});

	describe("the run agents", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const workersPath = `/runs/${running41}/workers`;

		function workerReads(requests: FactoryRequest[]): number {
			return requests.filter(
				(request) => new URL(request.url).pathname === workersPath,
			).length;
		}

		async function agentsOf(base: string, runId: string): Promise<Response> {
			return settledRead(
				new URL(`/api/factory-runs/${encodeURIComponent(runId)}/agents`, base),
			);
		}

		test("the run detail gives the tool, last message and turn of each running agent and of the current stage", async () => {
			const feed = new EventFeed();
			const app = await serveRuns(
				{ ...hub, "/events": feed, [workersPath]: runWorkers },
				[41],
			);
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				await stream.ready;
				const [stageStarted] = hubEvents;
				feed.send({
					...stageStarted,
					item: { ...stageStarted?.item, node_path: "report/report" },
				});
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.stage === "report/report",
				);
				const response = await agentsOf(app.base, running41);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					agents: [
						{
							stage: "fix",
							tool: "Bash",
							lastMessage: "LABEL: fixed",
							turn: "running",
						},
						{
							stage: "report/report",
							tool: null,
							lastMessage:
								"When round 3 ends, the run reaches the final report node again and I write and publish the report then.",
							turn: "ended",
						},
					],
				});
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("the app reads /workers only when a client asks for the agents of a live run", async () => {
			const app = await serveRuns({ ...hub, [workersPath]: runWorkers }, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				expect(workerReads(app.requests)).toBe(0);
				await agentsOf(app.base, running41);
				expect(workerReads(app.requests)).toBeGreaterThan(0);
			} finally {
				await app.stop();
			}
		});

		test("a run that ends gives no agents and reads /workers no more", async () => {
			const app = await serveRuns({ ...hub, [workersPath]: runWorkers }, [41]);
			const stream = openEventStream(app.base);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				expect(
					(
						(await (await agentsOf(app.base, running41)).json()) as {
							agents: unknown[];
						}
					).agents,
				).toHaveLength(1);
				const [running, ...rest] = hubRuns.runs;
				app.factories[hubUrl] = {
					...hub,
					[workersPath]: runWorkers,
					"/runs": {
						runs: [{ ...running, status: { kind: "succeeded" } }, ...rest],
					},
				};
				app.advance(runPollMs);
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "succeeded",
				);
				await readWhere<{ agents: unknown[] }>(
					new URL(
						`/api/factory-runs/${encodeURIComponent(running41)}/agents`,
						app.base,
					),
					(body) => body.agents.length === 0,
				);
				const reads = workerReads(app.requests);
				const response = await agentsOf(app.base, running41);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ agents: [] });
				expect(workerReads(app.requests)).toBe(reads);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const response = await agentsOf(app.base, "no-such-run");
				expect(response.status).toBe(404);
			} finally {
				await app.stop();
			}
		});
	});

	describe("the run events", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const eventsPath = `/runs/${running41}/events`;

		type Sent = { id?: string; event?: string; data: unknown };

		/** Each SSE event of an API stream, without its comment lines. */
		function sentOf(text: string): Sent[] {
			return text
				.split("\n\n")
				.map((block) => {
					const fields = new Map(
						block
							.split("\n")
							.filter((line) => !line.startsWith(":") && line.includes(":"))
							.map((line) => {
								const at = line.indexOf(":");
								return [line.slice(0, at), line.slice(at + 1).trim()];
							}),
					);
					const data = fields.get("data");
					if (data === undefined) {
						return null;
					}
					const id = fields.get("id");
					const event = fields.get("event");
					return {
						...(id === undefined ? {} : { id }),
						...(event === undefined ? {} : { event }),
						data: JSON.parse(data),
					};
				})
				.filter((sent) => sent !== null);
		}

		function shown(frame: (typeof runEvents)[number]): Sent {
			return {
				id: frame.id,
				data: {
					id: frame.id,
					event: frame.item.event,
					stage: frame.item.node_path,
					at: frame.recorded_at,
					data: frame.item.data,
				},
			};
		}

		async function eventsOf(
			base: string,
			headers: Record<string, string> = {},
		): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return fetch(
				new URL(
					`/api/factory-runs/${encodeURIComponent(running41)}/events`,
					base,
				),
				{ headers },
			);
		}

		async function untilSent(
			read: ReadableStreamDefaultReader<Uint8Array>,
			accept: (sent: Sent[]) => boolean,
		): Promise<Sent[]> {
			const decoder = new TextDecoder();
			let text = "";
			while (!accept(sentOf(text))) {
				const chunk = await read.read();
				if (chunk.done) {
					break;
				}
				text += decoder.decode(chunk.value, { stream: true });
			}
			return sentOf(text);
		}

		test("a run on a box streams every event of the run through the hub, then its new events, then the end of the run", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, [eventsPath]: feed }, [41]);
			try {
				const response = await eventsOf(app.base);
				expect(response.status).toBe(200);
				expect(response.headers.get("content-type")).toBe("text/event-stream");
				const read = response.body?.getReader();
				if (read === undefined) {
					throw new Error("the event stream has no body");
				}
				await feed.connected(1);
				for (const frame of runEvents) {
					feed.send(frame);
				}
				const replay = await untilSent(
					read,
					(sent) => sent.length === runEvents.length,
				);
				expect(replay).toEqual(runEvents.map(shown));
				const [, , , , , , turnEnded] = runEvents;
				if (turnEnded === undefined) {
					throw new Error("the run events fixture lost an event");
				}
				const live = {
					...turnEnded,
					seq: 8,
					id: "7c3a9d8e6f5b4a4c5d0e9f8a7b6c5d08",
					recorded_at: "2026-10-25T14:21:03.512+00:00",
					item: {
						event: "stage.completed",
						node_path: "plan",
						data: { name: "plan", index: 1, duration: 1193.0 },
					},
				};
				feed.send(live);
				feed.drop();
				expect(await untilSent(read, () => false)).toEqual([
					shown(live),
					{ event: "end", data: { reason: "ended" } },
				]);
				expect(
					app.requests
						.filter((request) => new URL(request.url).pathname === eventsPath)
						.map((request) => request.url),
				).toEqual([`${hubUrl}${eventsPath}`]);
			} finally {
				await app.stop();
			}
		});

		test("a Last-Event-ID sent to the app reaches the hub, so the stream starts after that event", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, [eventsPath]: feed }, [41]);
			const [, , seen] = runEvents;
			if (seen === undefined) {
				throw new Error("the run events fixture lost an event");
			}
			try {
				const response = await eventsOf(app.base, {
					"last-event-id": seen.id,
				});
				await feed.connected(1);
				expect(
					app.requests
						.filter((request) => new URL(request.url).pathname === eventsPath)
						.map((request) => request.lastEventId),
				).toEqual([seen.id]);
				const rest = runEvents.slice(3);
				for (const frame of rest) {
					feed.send(frame);
				}
				feed.drop();
				expect(await response.text().then(sentOf)).toEqual([
					...rest.map(shown),
					{ event: "end", data: { reason: "ended" } },
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 on the run events ends the stream as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await eventsOf(app.base);
				expect(response.status).toBe(200);
				expect(sentOf(await response.text())).toEqual([
					{ event: "end", data: { reason: "not served" } },
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that does not answer ends the stream as unreachable", async () => {
			const app = await serveRuns(
				{
					...hub,
					[eventsPath]: () => new Response("bad gateway", { status: 502 }),
				},
				[41],
			);
			try {
				const response = await eventsOf(app.base);
				expect(sentOf(await response.text())).toEqual([
					{ event: "end", data: { reason: "unreachable" } },
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const response = await fetch(
					new URL("/api/factory-runs/no-such-run/events", app.base),
				);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});
	});

	describe("the run artifacts", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const listPath = `/runs/${running41}/artifacts`;
		const responsePath = `${listPath}/plan%40v1.a1/response.md`;
		const verdictPath = `${listPath}/review%40v1.a1/child/verdict%40v1.a1/artifacts/verdict.json`;
		const verdict = {
			...runArtifacts.artifacts[5],
			encoding: "utf-8",
			content: '{"verdict":"ship","findings":[]}',
		};

		async function artifactRead(base: string, path: string): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return settledRead(
				new URL(
					`/api/factory-runs/${encodeURIComponent(running41)}${path}`,
					base,
				),
			);
		}

		const listOf = (base: string) => artifactRead(base, "/artifacts");

		const artifactOf = (base: string, folder: string, name: string) =>
			artifactRead(
				base,
				`/artifact?${new URLSearchParams({ folder, name }).toString()}`,
			);

		/** Each artifact URL that the app read, once: a stale read reads again in the background. */
		const artifactRequests = (requests: FactoryRequest[]) => [
			...new Set(
				requests
					.filter((request) =>
						new URL(request.url).pathname.startsWith(listPath),
					)
					.map((request) => request.url),
			),
		];

		test("a run on a box lists its artifacts through the hub, each with its stage folder, stage, name, type and size", async () => {
			const app = await serveRuns({ ...hub, [listPath]: runArtifacts }, [41]);
			try {
				const response = await listOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					artifacts: runArtifacts.artifacts.map((artifact) => ({
						folder: artifact.stage,
						stage: artifact.node_path,
						name: artifact.name,
						type: artifact.type,
						size: artifact.size,
					})),
				});
				expect(artifactRequests(app.requests)).toEqual([
					`${hubUrl}${listPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run on a box gives the content of one artifact through the hub", async () => {
			const app = await serveRuns(
				{ ...hub, [responsePath]: runArtifact, [verdictPath]: verdict },
				[41],
			);
			try {
				const response = await artifactOf(
					app.base,
					"plan@v1.a1",
					"response.md",
				);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({
					folder: "plan@v1.a1",
					stage: "plan",
					name: "response.md",
					type: "text/markdown",
					size: runArtifact.size,
					encoding: "utf-8",
					content: runArtifact.content,
				});
				const nested = await artifactOf(
					app.base,
					"review@v1.a1/child/verdict@v1.a1",
					"artifacts/verdict.json",
				);
				expect(await nested.json()).toMatchObject({
					stage: "review/verdict",
					content: verdict.content,
				});
				expect(artifactRequests(app.requests)).toEqual([
					`${hubUrl}${responsePath}`,
					`${hubUrl}${verdictPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run that a hub and its box report reads its artifacts from the hub, and the box gets no read", async () => {
			const [row41] = hubRuns.runs;
			if (row41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				{ ...hub, [listPath]: runArtifacts, [responsePath]: runArtifact },
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(row41, "running")] },
					[listPath]: runArtifacts,
					[responsePath]: runArtifact,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect((await listOf(app.base)).status).toBe(200);
				expect(
					(await artifactOf(app.base, "plan@v1.a1", "response.md")).status,
				).toBe(200);
				expect(artifactRequests(app.requests)).toEqual([
					`${hubUrl}${listPath}`,
					`${hubUrl}${responsePath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 on the artifact list reports the artifacts as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await listOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		test("an artifact that the factory does not hold answers 404", async () => {
			const app = await serveRuns({ ...hub, [listPath]: runArtifacts }, [41]);
			try {
				const response = await artifactOf(app.base, "plan@v1.a1", "nope.md");
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				for (const path of [
					"/api/factory-runs/no-such-run/artifacts",
					"/api/factory-runs/no-such-run/artifact?folder=plan%40v1.a1&name=response.md",
				]) {
					const response = await settledRead(new URL(path, app.base));
					expect(response.status).toBe(404);
					expect(await response.json()).toEqual({ missing: true });
				}
			} finally {
				await app.stop();
			}
		});
	});

	describe("the run sandbox", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const sandboxPath = `/runs/${running41}/sandbox`;

		async function sandboxOf(base: string): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return settledRead(
				new URL(
					`/api/factory-runs/${encodeURIComponent(running41)}/sandbox`,
					base,
				),
			);
		}

		/** Each sandbox URL that the app read, once: a stale read reads again in the background. */
		const sandboxRequests = (requests: FactoryRequest[]) => [
			...new Set(
				requests
					.filter((request) => new URL(request.url).pathname === sandboxPath)
					.map((request) => request.url),
			),
		];

		test("a run on a box gives its host, worktree, branch, base and workspace state through the hub", async () => {
			const app = await serveRuns({ ...hub, [sandboxPath]: runSandbox }, [41]);
			try {
				const response = await sandboxOf(app.base);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual(runSandbox);
				expect(sandboxRequests(app.requests)).toEqual([
					`${hubUrl}${sandboxPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a run whose worktree is gone gives the removed state", async () => {
			const removed = {
				...runSandbox,
				branch: null,
				head: null,
				base: null,
				ahead: null,
				state: "removed",
				changes: [],
			};
			const app = await serveRuns({ ...hub, [sandboxPath]: removed }, [41]);
			try {
				expect(await (await sandboxOf(app.base)).json()).toEqual(removed);
			} finally {
				await app.stop();
			}
		});

		test("a run that a hub and its box report reads its sandbox from the hub, and the box gets no read", async () => {
			const [row41] = hubRuns.runs;
			if (row41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				{ ...hub, [sandboxPath]: runSandbox },
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(row41, "running")] },
					[sandboxPath]: runSandbox,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect((await sandboxOf(app.base)).status).toBe(200);
				expect(sandboxRequests(app.requests)).toEqual([
					`${hubUrl}${sandboxPath}`,
				]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 reports the sandbox as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await sandboxOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const response = await settledRead(
					new URL("/api/factory-runs/no-such-run/sandbox", app.base),
				);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});
	});

	describe("the run detail", () => {
		const [running41, , , failed39] = hubRuns.runs;
		if (running41 === undefined || failed39 === undefined) {
			throw new Error("the hub runs fixture lost a run");
		}

		function detailOf(base: string, id: string): Promise<Response> {
			return fetch(
				new URL(`/api/factory-runs/${encodeURIComponent(id)}`, base),
			);
		}

		/** The first read answers without the workflow, and a later read has it from the graph read. */
		function workflowDetailOf(base: string, id: string): Promise<RunDetail> {
			return readWhere<RunDetail>(
				new URL(`/api/factory-runs/${encodeURIComponent(id)}`, base),
				(body) => body.workflow !== undefined,
			);
		}

		test("a run on a box gives its facts, failure reason and workflow through the hub", async () => {
			const graphPath = `/runs/${failed39.id}/graph`;
			const app = await serveRuns({ ...hub, [graphPath]: runGraph }, [39]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 39) !== undefined,
				);
				expect(await workflowDetailOf(app.base, failed39.id)).toMatchObject({
					id: failed39.id,
					key: "39",
					repo: "acme/widget",
					statusKind: "failed",
					box: "box-a",
					factory: "work hub",
					startedAt: "2026-10-25T12:00:09+00:00",
					endedAt: "2026-10-25T12:30:00+00:00",
					failureReason: "stage review failed",
					workflow: runGraph.name,
				});
				expect(
					app.requests
						.filter((request) => request.url.endsWith("/graph"))
						.map((request) => request.url),
				).toEqual([`${hubUrl}${graphPath}`]);
			} finally {
				await app.stop();
			}
		});

		test("a run on a standalone factory gives its facts and workflow from that factory", async () => {
			const laptopRun = {
				...boxRow(running41, "running"),
				id: "20261025-141800-f7a8",
				ticket: "43",
			};
			const app = await serveRuns(
				hub,
				[43],
				{},
				{
					...daemon,
					"/runs": { runs: [laptopRun] },
					[`/runs/${laptopRun.id}/graph`]: runGraph,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 43) !== undefined,
				);
				const detail = await workflowDetailOf(app.base, laptopRun.id);
				expect(detail).toMatchObject({
					id: laptopRun.id,
					key: "43",
					statusKind: "running",
					box: "laptop",
					factory: "laptop",
					workflow: runGraph.name,
				});
				expect(detail).not.toHaveProperty("failureReason");
				expect(
					app.requests
						.filter((request) => request.url.endsWith("/graph"))
						.map((request) => request.unix),
				).toEqual([laptopSocket]);
			} finally {
				await app.stop();
			}
		});

		test("the run detail gives the last event of the run from the event stream", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, "/events": feed }, [41]);
			try {
				await feed.connected(1);
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const [planStarted] = hubEvents;
				feed.send(planStarted);
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.stage === "plan",
				);
				const response = await detailOf(app.base, running41.id);
				expect(await response.json()).toMatchObject({
					stage: "plan",
					lastEvent: {
						event: "stage.started",
						stage: "plan",
						at: "2026-10-25T14:21:03.512+00:00",
					},
				});
			} finally {
				await app.stop();
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41) !== undefined,
				);
				const response = await detailOf(app.base, "no-such-run");
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});
	});
});

describe("the runs list", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}

	async function runsWhere(
		base: string,
		accept: (rows: RunListRow[]) => boolean,
	): Promise<RunListRow[]> {
		while (true) {
			const response = await fetch(new URL("/api/factory-runs", base));
			expect(response.status).toBe(200);
			const rows = (await response.json()) as RunListRow[];
			if (accept(rows)) {
				return rows;
			}
			await Bun.sleep(20);
		}
	}

	test("lists the runs of every factory, live and ended, once for each run id, newest first", async () => {
		const laptopRun = {
			...boxRow(running41, "succeeded"),
			id: "20261025-143000-d1e2",
			ticket: "43",
			submitted_at: "2026-10-25T14:30:00+00:00",
			started_at: "2026-10-25T14:30:04+00:00",
			ended_at: "2026-10-25T14:52:00+00:00",
		};
		const app = await serveRuns(
			hub,
			[39, 40, 41, 42, 43],
			{},
			{
				...daemon,
				"/runs": { runs: [laptopRun, boxRow(running41, "blocked")] },
			},
		);
		try {
			const rows = await runsWhere(
				app.base,
				(seen) =>
					seen.length === 5 &&
					seen.every((row) => row.title !== undefined) &&
					seen.some((row) => row.id === running41.id && row.box === "laptop"),
			);
			expect(
				rows.map((row) => [
					row.id,
					row.key,
					row.title,
					row.project,
					row.statusKind,
					row.factory,
					row.box,
				]),
			).toEqual([
				[
					laptopRun.id,
					`${repo}#43`,
					"Ticket 43",
					repo,
					"succeeded",
					"laptop",
					"laptop",
				],
				[
					"20261025-141500-e5f6",
					`${repo}#42`,
					"Ticket 42",
					repo,
					"queued",
					"work hub",
					null,
				],
				[
					running41.id,
					`${repo}#41`,
					"Ticket 41",
					repo,
					"blocked",
					"laptop",
					"laptop",
				],
				[
					"20261025-130511-c3d4",
					`${repo}#40`,
					"Ticket 40",
					repo,
					"succeeded",
					"work hub",
					"box-b",
				],
				[
					"20261025-120000-a7b8",
					`${repo}#39`,
					"Ticket 39",
					repo,
					"failed",
					"work hub",
					"box-a",
				],
			]);
		} finally {
			await app.stop();
		}
	});

	test("each run gives the usage totals that its factory lists, and the box row wins over the hub row", async () => {
		const usage = (input: number, cost: number, seconds: number) => ({
			tokens: { input, output: input / 10 },
			cost_usd: cost,
			duration_s: seconds,
		});
		const [, succeeded40, queued42, failed39] = hubRuns.runs;
		if (
			succeeded40 === undefined ||
			queued42 === undefined ||
			failed39 === undefined
		) {
			throw new Error("the hub runs fixture lost a run");
		}
		const app = await serveRuns(
			{
				...hub,
				"/runs": {
					runs: [
						{ ...running41, usage: usage(1000, 0.25, 30) },
						{ ...succeeded40, usage: usage(5000, 1.5, 300) },
						{ ...queued42, usage: usage(0, 0, 0) },
						failed39,
					],
				},
			},
			[39, 40, 41, 42],
			{},
			{
				...daemon,
				"/runs": {
					runs: [
						{
							...boxRow(running41, "running"),
							usage: usage(2000, 0.5, 60),
						},
					],
				},
			},
		);
		try {
			const rows = await runsWhere(app.base, (seen) =>
				seen.some((row) => row.id === running41.id && row.box === "laptop"),
			);
			expect(
				Object.fromEntries(rows.map((row) => [row.id, row.usageTotals])),
			).toEqual({
				[running41.id]: {
					inputTokens: 2000,
					outputTokens: 200,
					costUsd: 0.5,
					durationS: 60,
				},
				[succeeded40.id]: {
					inputTokens: 5000,
					outputTokens: 500,
					costUsd: 1.5,
					durationS: 300,
				},
				[queued42.id]: {
					inputTokens: 0,
					outputTokens: 0,
					costUsd: 0,
					durationS: 0,
				},
				[failed39.id]: undefined,
			});
		} finally {
			await app.stop();
		}
	});

	test("a run of an untracked ticket gives its repo key", async () => {
		const app = await serveRuns(hub, [41]);
		try {
			const rows = await runsWhere(app.base, (seen) =>
				seen.some((row) => row.title !== undefined),
			);
			const untracked = rows.find((row) => row.id === "20261025-130511-c3d4");
			expect(untracked).toMatchObject({ key: `${repo}#40`, project: repo });
			expect(untracked).not.toHaveProperty("title");
		} finally {
			await app.stop();
		}
	});

	test("each run gives the PR that it opened and its result, and two runs of one ticket each give their own", async () => {
		/** A run row of `ticket` that ended with `status`. */
		const ended = (
			id: string,
			ticket: string,
			status: { kind: string; reason: string | null },
		) => ({
			...running41,
			id,
			ticket,
			status,
			submitted_at: `2026-10-25T${id.slice(9, 11)}:00:00+00:00`,
			ended_at: "2026-10-25T13:00:00+00:00",
		});
		/** The `GET /runs/{id}` answer of `row`, with the PR that it opened. */
		const detail = (
			row: { id: string; ticket: string },
			number: number | null,
			mergeSha: string | null = null,
		) => ({
			...runDetail,
			...row,
			outputs: {
				...runDetail.outputs,
				issue: row.ticket,
				pr_url:
					number === null ? null : `https://github.com/${repo}/pull/${number}`,
				merge_sha: mergeSha,
			},
			pr:
				number === null
					? null
					: {
							...runDetail.pr,
							number,
							url: `https://github.com/${repo}/pull/${number}`,
						},
		});
		const [, prOpen40, queued42, failed39] = hubRuns.runs;
		if (
			prOpen40 === undefined ||
			queued42 === undefined ||
			failed39 === undefined
		) {
			throw new Error("the hub runs fixture lost a run");
		}
		const merged41 = ended("20261025-100000-0000", "41", {
			kind: "succeeded",
			reason: null,
		});
		const noPr43 = ended("20261025-090000-0043", "43", {
			kind: "succeeded",
			reason: null,
		});
		const cancelled44 = ended("20261025-080000-0044", "44", {
			kind: "failed",
			reason: "stopped",
		});
		const mergedUntracked = ended("20261025-070000-0038", "38", {
			kind: "succeeded",
			reason: null,
		});
		const app = await serveRuns(
			{
				...hub,
				"/runs": {
					runs: [
						...hubRuns.runs,
						merged41,
						noPr43,
						cancelled44,
						mergedUntracked,
					],
				},
				[`/runs/${running41.id}`]: detail(running41, 77),
				[`/runs/${prOpen40.id}`]: runDetail,
				[`/runs/${failed39.id}`]: detail(failed39, null),
				[`/runs/${merged41.id}`]: detail(merged41, 70),
				[`/runs/${noPr43.id}`]: detail(noPr43, null),
				[`/runs/${cancelled44.id}`]: detail(cancelled44, null),
				[`/runs/${mergedUntracked.id}`]: detail(
					mergedUntracked,
					60,
					"b".repeat(40),
				),
			},
			[39, 40, 41, 43, 44],
			{},
			undefined,
			[
				githubPullNode(pull(77, 41)),
				githubPullNode(pull(72, 40, undefined, true)),
			],
			[
				githubPullNode({
					...pull(70, 41),
					state: "closed",
					merged_at: "2026-10-25T09:50:00Z",
				}),
			],
		);
		try {
			const rows = await runsWhere(
				app.base,
				(seen) =>
					seen.filter((row) => row.pull !== undefined).length === 4 &&
					seen.filter((row) => row.title !== undefined).length === 6,
			);
			expect(
				rows.map((row) => [row.key, row.statusKind, row.pull, row.result]),
			).toEqual([
				[`${repo}#42`, "queued", undefined, undefined],
				[
					`${repo}#41`,
					"running",
					{ number: 77, url: `https://github.com/${repo}/pull/77` },
					undefined,
				],
				[
					`${repo}#40`,
					"succeeded",
					{ number: 72, url: `https://github.com/${repo}/pull/72` },
					"prOpen",
				],
				[`${repo}#39`, "failed", undefined, "failed"],
				[
					`${repo}#41`,
					"succeeded",
					{ number: 70, url: `https://github.com/${repo}/pull/70` },
					"merged",
				],
				[`${repo}#43`, "succeeded", undefined, "noPr"],
				[`${repo}#44`, "failed", undefined, "cancelled"],
				[
					`${repo}#38`,
					"succeeded",
					{ number: 60, url: `https://github.com/${repo}/pull/60` },
					"merged",
				],
			]);
			expect(
				app.requests.some((request) =>
					request.url.endsWith(`/runs/${queued42.id}`),
				),
			).toBe(false);
		} finally {
			await app.stop();
		}
	});
});

describe("factory questions", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const [question] = runQuestions.questions;
	if (question === undefined) {
		throw new Error("the run questions fixture lost its question");
	}
	const questionsPath = `/runs/${running41.id}/questions`;
	const answerPath = `${questionsPath}/${question.id}/answer`;
	const answered = { ...question, answer: "Add the scope." };

	function blockedHub(questions: unknown = runQuestions): Answers {
		return {
			...hubWith41("blocked"),
			[questionsPath]: questions,
			[answerPath]: answered,
		};
	}

	async function servedQuestions(
		hubAnswers: Answers,
		boxAnswers?: Answers,
	): Promise<Awaited<ReturnType<typeof serveRuns>>> {
		const app = await serveRuns(hubAnswers, [41], {}, boxAnswers);
		await overviewWhere(
			app.base,
			(seen) => factoryRunOf(seen, 41)?.questions !== undefined,
		);
		return app;
	}

	async function needsYouOf(base: string): Promise<NeedsYouItem[]> {
		const response = await fetch(new URL("/api/needs-you", base));
		expect(response.status).toBe(200);
		return (await response.json()) as NeedsYouItem[];
	}

	function sendAnswer(base: string, questionId: string, text: string) {
		return fetch(
			new URL(
				`/api/factory-runs/${running41?.id}/questions/${questionId}/answer`,
				base,
			),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text }),
			},
		);
	}

	function posts(requests: FactoryRequest[]): FactoryRequest[] {
		return requests.filter((request) => request.method !== "GET");
	}

	test("a recorded open question gives an ask in Needs you with the factory as its source", async () => {
		const app = await servedQuestions(blockedHub());
		try {
			const asks = (await needsYouOf(app.base)).filter(
				(item) => item.key === `${repo}#41`,
			);
			expect(asks).toEqual([
				expect.objectContaining({
					reason: "ask",
					headline: question.text,
					question: question.text,
					answered: false,
					factoryAsk: {
						factory: "work hub",
						run: running41.id,
						question: String(question.id),
					},
				}),
			]);
		} finally {
			await app.stop();
		}
	});

	test("the newest run of a blocked ticket lists its open questions", async () => {
		const app = await servedQuestions(blockedHub());
		try {
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			expect(factoryRunOf(body, 41)?.questions).toEqual([
				{ id: String(question.id), text: question.text },
			]);
		} finally {
			await app.stop();
		}
	});

	test("a question that does not name Lev goes to the PM Bot and gives no ask", async () => {
		const app = await servedQuestions(
			blockedHub({
				questions: [
					{ ...question, text: "Senior, should the run keep the old branch?" },
				],
			}),
		);
		try {
			expect(
				(await needsYouOf(app.base)).filter(
					(item) => item.key === `${repo}#41`,
				),
			).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("an answer sent through the API reaches the factory as one answer POST", async () => {
		const app = await servedQuestions(blockedHub());
		try {
			app.factories[hubUrl] = { ...hub, [answerPath]: answered };
			const response = await sendAnswer(
				app.base,
				String(question.id),
				"Add the scope.",
			);
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${answerPath}`,
					unix: null,
					method: "POST",
					body: JSON.stringify({ text: "Add the scope.", sender: "lev" }),
				},
			]);
			expect(
				(await needsYouOf(app.base)).filter(
					(item) => item.key === `${repo}#41`,
				),
			).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("an answer to a question that the run does not wait on is refused and sends nothing", async () => {
		const app = await servedQuestions(blockedHub());
		try {
			const response = await sendAnswer(app.base, "8", "Add the scope.");
			expect(response.status).toBe(404);
			expect(posts(app.requests)).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a stream frame that blocks a run reads its questions, and a frame that resumes it clears them", async () => {
		const feed = new EventFeed();
		const app = await serveRuns(
			{ ...hub, "/events": feed, [questionsPath]: runQuestions },
			[41],
		);
		const stream = openEventStream(app.base);
		try {
			await feed.connected(1);
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
			);
			await stream.ready;
			feed.send({ run_id: running41.id, status: { kind: "blocked" } });
			const blocked = await overviewEventWhere(
				stream.events,
				(seen) => factoryRunOf(seen, 41)?.questions !== undefined,
			);
			expect(factoryRunOf(blocked, 41)).toMatchObject({
				statusKind: "blocked",
				questions: [{ id: String(question.id), text: question.text }],
			});
			feed.send({ run_id: running41.id, status: { kind: "running" } });
			const resumed = await overviewEventWhere(
				stream.events,
				(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
			);
			expect(factoryRunOf(resumed, 41)?.questions).toBeUndefined();
			expect(
				(await needsYouOf(app.base)).filter(
					(item) => item.key === `${repo}#41`,
				),
			).toEqual([]);
		} finally {
			stream.close();
			await app.stop();
		}
	});

	test("an answer to a run that a hub and its box report goes to the hub, and the box gets no answer", async () => {
		const app = await servedQuestions(blockedHub(), {
			...daemon,
			"/runs": { runs: [boxRow(running41, "blocked")] },
			[questionsPath]: runQuestions,
			[answerPath]: answered,
		});
		try {
			const response = await sendAnswer(
				app.base,
				String(question.id),
				"Add the scope.",
			);
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${answerPath}`,
					unix: null,
					method: "POST",
					body: JSON.stringify({ text: "Add the scope.", sender: "lev" }),
				},
			]);
		} finally {
			await app.stop();
		}
	});
});

describe("factory steers", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const steerPath = `/runs/${running41.id}/steer`;
	const steer = { stage: "implement", text: "Use the v2 API", interrupt: true };
	const steered = { id: 1, run_id: running41.id, ...steer, sender: "lev" };

	async function servedRun(
		hubAnswers: Answers,
		boxAnswers?: Answers,
	): Promise<Awaited<ReturnType<typeof serveRuns>>> {
		const app = await serveRuns(hubAnswers, [41], {}, boxAnswers);
		await overviewWhere(
			app.base,
			(seen) => factoryRunOf(seen, 41) !== undefined,
		);
		return app;
	}

	function sendSteer(base: string) {
		return fetch(new URL(`/api/factory-runs/${running41?.id}/steer`, base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(steer),
		});
	}

	function posts(requests: FactoryRequest[]): FactoryRequest[] {
		return requests.filter((request) => request.method !== "GET");
	}

	const hubSteer = {
		url: `${hubUrl}${steerPath}`,
		unix: null,
		method: "POST",
		body: JSON.stringify({ ...steer, sender: "lev" }),
	};

	test("a steer sent through the API reaches the factory as one steer POST with Lev as the sender", async () => {
		const app = await servedRun({ ...hub, [steerPath]: steered });
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ steered: true });
			expect(posts(app.requests)).toEqual([hubSteer]);
		} finally {
			await app.stop();
		}
	});

	test("a steer to a run that a hub and its box report goes to the hub, and the box gets no steer", async () => {
		const app = await servedRun(
			{ ...hub, [steerPath]: steered },
			{
				...daemon,
				"/runs": { runs: [boxRow(running41, "running")] },
				[steerPath]: steered,
			},
		);
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([hubSteer]);
		} finally {
			await app.stop();
		}
	});

	test("a 409 from the factory for an ended run gives a clear error", async () => {
		const app = await servedRun({
			...hub,
			[steerPath]: Response.json(
				{ error: `run ${running41.id} has already ended` },
				{ status: 409 },
			),
		});
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "the run has ended, so it takes no steer",
			});
			expect(posts(app.requests)).toEqual([hubSteer]);
		} finally {
			await app.stop();
		}
	});
});

describe("factory cancels", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const cancelPath = `/runs/${running41.id}/cancel`;
	const stopped = <Row extends object>(row: Row) => ({
		...row,
		status: { kind: "failed", reason: "stopped" },
		ended_at: "2026-10-25T14:30:00+00:00",
	});

	/** Factories that report a run as running until one of them takes a cancel, and as stopped after. */
	function stopOnCancel() {
		let cancelled = false;
		return {
			runs:
				<Row extends object>(row: Row) =>
				() => ({ runs: [cancelled ? stopped(row) : row] }),
			cancel:
				<Row extends object>(row: Row) =>
				() => {
					cancelled = true;
					return stopped(row);
				},
		};
	}

	async function servedRun(
		hubAnswers: Answers,
		boxAnswers?: Answers,
	): Promise<Awaited<ReturnType<typeof serveRuns>>> {
		const app = await serveRuns(hubAnswers, [41], {}, boxAnswers);
		await overviewWhere(
			app.base,
			(seen) => factoryRunOf(seen, 41) !== undefined,
		);
		return app;
	}

	function sendCancel(base: string) {
		return fetch(new URL(`/api/factory-runs/${running41?.id}/cancel`, base), {
			method: "POST",
		});
	}

	async function runStatus(base: string): Promise<string> {
		const response = await fetch(
			new URL(`/api/factory-runs/${running41?.id}`, base),
		);
		const run = (await response.json()) as RunDetail;
		return run.statusKind;
	}

	function posts(requests: FactoryRequest[]): FactoryRequest[] {
		return requests.filter((request) => request.method !== "GET");
	}

	test("a cancel of a run that a hub and its box report goes to the hub, and the run then reads as failed", async () => {
		const stop = stopOnCancel();
		const onBox = boxRow(running41, "running");
		const app = await servedRun(
			{
				...hub,
				"/runs": stop.runs(running41),
				[cancelPath]: stop.cancel(running41),
			},
			{
				...daemon,
				"/runs": stop.runs(onBox),
				[cancelPath]: stop.cancel(onBox),
			},
		);
		try {
			expect(await runStatus(app.base)).toBe("running");
			const response = await sendCancel(app.base);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ cancelled: true });
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${cancelPath}`,
					unix: null,
					method: "POST",
					body: "{}",
				},
			]);
			expect(await runStatus(app.base)).toBe("failed");
		} finally {
			await app.stop();
		}
	});

	test("a cancel of a run that only a standalone factory reports goes to that factory, and the run then reads as failed", async () => {
		const stop = stopOnCancel();
		const onBox = boxRow(running41, "running");
		const app = await servedRun(
			{ ...hub, "/runs": { runs: [] } },
			{
				...daemon,
				"/runs": stop.runs(onBox),
				[cancelPath]: stop.cancel(onBox),
			},
		);
		try {
			expect(await runStatus(app.base)).toBe("running");
			const response = await sendCancel(app.base);
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([
				{
					url: `http://localhost${cancelPath}`,
					unix: laptopSocket,
					method: "POST",
					body: "{}",
				},
			]);
			expect(await runStatus(app.base)).toBe("failed");
		} finally {
			await app.stop();
		}
	});

	test("a 409 from the factory for an ended run gives a clear error", async () => {
		const app = await servedRun({
			...hub,
			[cancelPath]: Response.json(
				{ error: `run ${running41.id} has already ended` },
				{ status: 409 },
			),
		});
		try {
			const response = await sendCancel(app.base);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "the run has already ended",
			});
		} finally {
			await app.stop();
		}
	});
});

describe("factory resumes and restarts", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const failed41 = {
		...running41,
		status: { kind: "failed", reason: "stage review failed" },
		ended_at: "2026-10-25T14:30:00+00:00",
		restarted_from: null,
	};
	const restarted41 = {
		...running41,
		id: "20261025-143500-f7a8",
		status: { kind: "submitted", reason: null },
		submitted_at: "2026-10-25T14:35:00+00:00",
		started_at: null,
		machine: null,
		restarted_from: failed41.id,
	};
	/** The row of a run as the box that does it reports it. */
	const onBox = (row: object, kind: string) => ({
		...row,
		status: { kind, reason: null },
		source: null,
		rule: null,
		machine: "local",
	});
	const resumePath = `/runs/${failed41.id}/resume`;
	const restartPath = `/runs/${failed41.id}/restart`;

	/** A factory that reports `rows` until it takes a write, and `after` then. */
	function changeOnWrite(rows: object[], after: object[], answer: object) {
		let written = false;
		return {
			runs: () => ({ runs: written ? after : rows }),
			write: () => {
				written = true;
				return answer;
			},
		};
	}

	async function servedRun(
		hubAnswers: Answers,
		boxAnswers?: Answers,
	): Promise<Awaited<ReturnType<typeof serveRuns>>> {
		const app = await serveRuns(hubAnswers, [41], {}, boxAnswers);
		await overviewWhere(
			app.base,
			(seen) => factoryRunOf(seen, 41) !== undefined,
		);
		return app;
	}

	function send(base: string, action: "resume" | "restart") {
		return fetch(new URL(`/api/factory-runs/${failed41.id}/${action}`, base), {
			method: "POST",
		});
	}

	async function detailOf(base: string, id: string): Promise<RunDetail> {
		const response = await fetch(new URL(`/api/factory-runs/${id}`, base));
		return (await response.json()) as RunDetail;
	}

	function posts(requests: FactoryRequest[]): FactoryRequest[] {
		return requests.filter((request) => request.method !== "GET");
	}

	test("a resume of a run that a hub and its box report goes to the hub and keeps the run id", async () => {
		const resumed = {
			...failed41,
			status: { kind: "submitted", reason: null },
		};
		let forwarded = false;
		const app = await servedRun(
			{
				...hub,
				"/runs": () => ({ runs: [forwarded ? resumed : failed41] }),
				[resumePath]: () => {
					forwarded = true;
					return resumed;
				},
			},
			{
				...daemon,
				"/runs": () => ({
					runs: [
						forwarded ? onBox(resumed, "running") : onBox(failed41, "failed"),
					],
				}),
			},
		);
		try {
			expect((await detailOf(app.base, failed41.id)).statusKind).toBe("failed");
			const response = await send(app.base, "resume");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: failed41.id });
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${resumePath}`,
					unix: null,
					method: "POST",
					body: "{}",
				},
			]);
			expect((await detailOf(app.base, failed41.id)).statusKind).toBe(
				"running",
			);
		} finally {
			await app.stop();
		}
	});

	test("a restart of a run that a hub and its box report goes to the hub, gives the new run id, and the new run names the old run", async () => {
		const hubSide = changeOnWrite(
			[failed41],
			[restarted41, failed41],
			Response.json(restarted41, { status: 201 }),
		);
		const app = await servedRun(
			{ ...hub, "/runs": hubSide.runs, [restartPath]: hubSide.write },
			{ ...daemon, "/runs": { runs: [onBox(failed41, "failed")] } },
		);
		try {
			const response = await send(app.base, "restart");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: restarted41.id });
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${restartPath}`,
					unix: null,
					method: "POST",
					body: "{}",
				},
			]);
			const fresh = await detailOf(app.base, restarted41.id);
			expect(fresh.statusKind).toBe("queued");
			expect(fresh.restartedFrom).toBe(failed41.id);
			expect(
				(await detailOf(app.base, failed41.id)).restartedFrom,
			).toBeUndefined();
		} finally {
			await app.stop();
		}
	});

	test("a restart of a run that only a standalone factory reports goes to that factory", async () => {
		const oldOnBox = onBox(failed41, "failed");
		const freshOnBox = onBox(restarted41, "submitted");
		const boxSide = changeOnWrite(
			[oldOnBox],
			[freshOnBox, oldOnBox],
			Response.json(freshOnBox, { status: 201 }),
		);
		const app = await servedRun(
			{ ...hub, "/runs": { runs: [] } },
			{ ...daemon, "/runs": boxSide.runs, [restartPath]: boxSide.write },
		);
		try {
			const response = await send(app.base, "restart");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: restarted41.id });
			expect(posts(app.requests)).toEqual([
				{
					url: `http://localhost${restartPath}`,
					unix: laptopSocket,
					method: "POST",
					body: "{}",
				},
			]);
			expect((await detailOf(app.base, restarted41.id)).restartedFrom).toBe(
				failed41.id,
			);
		} finally {
			await app.stop();
		}
	});

	test("a 409 from the factory for a run that is not blocked or failed gives a clear error", async () => {
		const app = await servedRun({
			...hub,
			"/runs": { runs: [failed41] },
			[resumePath]: Response.json(
				{ error: `run ${failed41.id} is running` },
				{ status: 409 },
			),
		});
		try {
			const response = await send(app.base, "resume");
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "the run is not blocked or failed",
			});
		} finally {
			await app.stop();
		}
	});
});

describe("run thread", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const [question] = runQuestions.questions;
	if (question === undefined) {
		throw new Error("the run questions fixture lost its question");
	}
	const questionsPath = `/runs/${running41.id}/questions`;
	const answerPath = `${questionsPath}/${question.id}/answer`;
	const steerPath = `/runs/${running41.id}/steer`;
	const steer = steerDelivered.item.data;
	const steerMessage = {
		kind: "steer" as const,
		sender: steer.sender,
		text: steer.text,
		at: steer.delivered_at,
	};

	function post(base: string, path: string, body: unknown) {
		return fetch(new URL(path, base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("the run gives its asks, answers and delivered steers as one thread in time order, with the sender of each", async () => {
		const feed = new EventFeed();
		const app = await serveRuns(
			{
				...hubWith41("blocked"),
				"/events": feed,
				[questionsPath]: runQuestions,
				[answerPath]: { ...question, answer: "Add the scope." },
			},
			[41],
		);
		try {
			await feed.connected(1);
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.questions !== undefined,
			);
			app.advance(5 * 60_000);
			const answered = await post(
				app.base,
				`/api/factory-runs/${running41.id}/questions/${question.id}/answer`,
				{ text: "Add the scope." },
			);
			expect(answered.status).toBe(200);
			feed.send(steerDelivered);
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.thread?.length === 3,
			);
			expect(factoryRunOf(body, 41)?.thread).toEqual([
				{
					kind: "ask",
					sender: question.node_path,
					text: question.text,
					at: "2026-10-25T14:20:00.000Z",
				},
				{
					kind: "answer",
					sender: "lev",
					text: "Add the scope.",
					at: "2026-10-25T14:25:00.000Z",
				},
				steerMessage,
			]);
		} finally {
			await app.stop();
		}
	});

	test("a run that the app sees first after a restart gives its answered asks in the thread, with the answer, sender and time of each", async () => {
		const app = await serveRuns(
			{ ...hubWith41("running"), [questionsPath]: answeredQuestions },
			[41],
		);
		try {
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.thread?.length === 4,
			);
			const [scope, review] = answeredQuestions.answered;
			if (scope === undefined || review === undefined) {
				throw new Error("the answered questions fixture lost an ask");
			}
			expect(factoryRunOf(body, 41)?.thread).toEqual([
				{
					kind: "ask",
					sender: scope.node_path,
					text: scope.text,
					at: "2026-10-25T14:25:00+00:00",
				},
				{
					kind: "answer",
					sender: "lev",
					text: "Add the scope.",
					at: "2026-10-25T14:25:00+00:00",
				},
				{
					kind: "ask",
					sender: review.node_path,
					text: review.text,
					at: "2026-10-25T14:40:00+00:00",
				},
				{
					kind: "answer",
					sender: "someone",
					text: "Yes, add one.",
					at: "2026-10-25T14:40:00+00:00",
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("an answer that Lev sends joins the thread once when the resumed run lists it as answered", async () => {
		let resumed = false;
		const [, ...rest] = hubRuns.runs;
		const app = await serveRuns(
			{
				...hub,
				"/runs": () => ({
					runs: [
						{
							...running41,
							status: { kind: resumed ? "running" : "blocked" },
						},
						...rest,
					],
				}),
				[questionsPath]: () => (resumed ? answeredQuestions : runQuestions),
				[answerPath]: () => {
					resumed = true;
					return { ...question, answer: "Add the scope." };
				},
			},
			[41],
		);
		try {
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.questions !== undefined,
			);
			const answered = await post(
				app.base,
				`/api/factory-runs/${running41.id}/questions/${question.id}/answer`,
				{ text: "Add the scope." },
			);
			expect(answered.status).toBe(200);
			app.advance(60 * 60_000);
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.thread?.length === 4,
			);
			expect(
				factoryRunOf(body, 41)?.thread?.map(({ kind, sender, text }) => ({
					kind,
					sender,
					text,
				})),
			).toEqual([
				{ kind: "ask", sender: question.node_path, text: question.text },
				{ kind: "answer", sender: "lev", text: "Add the scope." },
				{
					kind: "ask",
					sender: "review/senior_question",
					text: "The review found no test for the scope check. Should the run add one?",
				},
				{ kind: "answer", sender: "someone", text: "Yes, add one." },
			]);
		} finally {
			await app.stop();
		}
	});

	test("a steer that Lev sends joins the thread once, when the factory reports it delivered", async () => {
		const feed = new EventFeed();
		const app = await serveRuns(
			{
				...hub,
				"/events": feed,
				[steerPath]: { id: steer.steer, run_id: running41.id, sender: "lev" },
			},
			[41],
		);
		try {
			await feed.connected(1);
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
			);
			const steered = await post(
				app.base,
				`/api/factory-runs/${running41.id}/steer`,
				{ stage: "implement", text: steer.text, interrupt: steer.interrupt },
			);
			expect(steered.status).toBe(200);
			const sent = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			expect(factoryRunOf(sent, 41)?.thread).toBeUndefined();
			feed.send(steerDelivered);
			feed.send(steerDelivered);
			const [planStarted] = hubEvents;
			feed.send(planStarted);
			const delivered = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.stage === "plan",
			);
			expect(factoryRunOf(delivered, 41)?.thread).toEqual([steerMessage]);
		} finally {
			await app.stop();
		}
	});
});
