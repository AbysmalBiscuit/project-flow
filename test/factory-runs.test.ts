import { describe, expect, test } from "bun:test";

import type {
	ProjectReport,
	ShownFactoryRun,
	TicketView,
} from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	json,
	serve,
} from "./factory-support.ts";
import hubRuns from "./fixtures/factory-hub-runs.json";
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

/** A hub and a tracked repo whose issues the test can change, on a clock the test advances. */
async function serveRuns(
	hubAnswers: Answers,
	issueNumbers: number[],
	comments: Record<number, Record<string, unknown>[]> = {},
) {
	const factories: Record<string, Answers | "down"> = { [hubUrl]: hubAnswers };
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
			factories: [{ name: "work hub", url: hubUrl }],
		},
		factoryFetch(factories, requests, tracker),
		{ env: { GITHUB_TOKEN: "recorded-token" }, now: () => new Date(now) },
	);
	return {
		...app,
		factories,
		issues,
		runReads: () =>
			requests.filter((request) => request.url === `${hubUrl}/runs`).length,
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
				statusKind: "running",
				box: "box-a",
				factory: "work hub",
				startedAt: "2026-10-25T14:01:10+00:00",
				endedAt: null,
				coveredByFeed: true,
			});
			expect(factoryRunOf(body, 39)).toEqual({
				statusKind: "failed",
				box: "box-a",
				factory: "work hub",
				startedAt: "2026-10-25T12:00:09+00:00",
				endedAt: "2026-10-25T12:30:00+00:00",
				coveredByFeed: true,
			});
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
				statusKind: "queued",
				box: null,
				factory: "work hub",
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
});
