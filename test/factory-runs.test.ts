import { describe, expect, test } from "bun:test";

import type {
	NeedsYouItem,
	ProjectReport,
	ShownFactoryRun,
	TicketView,
} from "../src/domain.ts";
import type { FactoryEntry } from "../src/factories.ts";
import type { Fetch } from "../src/fetch.ts";
import {
	type Answers,
	daemon,
	EventFeed,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	json,
	laptopUrl,
	readAnswerOrSteer,
	serve,
} from "./factory-support.ts";
import hubCheckpoint from "./fixtures/factory-hub-checkpoint.json";
import hubEvents from "./fixtures/factory-hub-events.json";
import hubRuns from "./fixtures/factory-hub-runs.json";
import runQuestions from "./fixtures/factory-run-questions.json";
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
import { recordedDiscovery, unrecorded, urlOf } from "./support.ts";

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
			expect(requests.filter((request) => !readAnswerOrSteer(request))).toEqual(
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
			});
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
					startedAt: "2026-10-25T10:00:05+00:00",
					endedAt: "2026-10-25T10:40:00+00:00",
				},
			]);
			expect(views(39)?.earlierFactoryRuns).toBeUndefined();
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

		test("a blocked factory run gives an open ask in Needs you", async () => {
			const app = await serveRuns(hubWith41("blocked"), [41]);
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
				fetch(
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
				const checkpoint = await checkpointOf();
				expect(checkpoint.status).toBe(200);
				expect(await checkpoint.json()).toMatchObject({ stage: "review" });
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
			return fetch(
				new URL(`/api/factory-runs/${encodeURIComponent(id)}/checkpoint`, base),
			);
		}

		test("the ticket's run carries the current stage, completed stages, retries and visits of its recorded checkpoint", async () => {
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

		test("a run whose factory gives no checkpoint answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await checkpointOf(app.base);
				expect(response.status).toBe(404);
			} finally {
				await app.stop();
			}
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
			return fetch(
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
				await agentsOf(app.base, running41);
				expect(workerReads(app.requests)).toBe(2);
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
					body: JSON.stringify({ text: "Add the scope." }),
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
					body: JSON.stringify({ text: "Add the scope." }),
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
