import { expect } from "bun:test";

import type {
	ProjectReport,
	ShownFactoryRun,
	TicketView,
} from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	laptopUrl,
	readOrRunWrite,
	serve,
} from "../support/factory.ts";
import { json, trackerRequest, urlOf } from "../support/fetch.ts";
import {
	issuesResponse,
	listedRead,
	page,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	ticket,
	unrecorded,
} from "../support/github.ts";

export type RunOverview = {
	projects: { tickets: TicketView[] }[];
	polling?: true;
	factoryUnreachable?: true;
};

export const runClockStart = Date.parse("2026-10-25T14:20:00Z");

export function factoryRunOf(
	body: RunOverview,
	number: number,
): ShownFactoryRun | undefined {
	return body.projects
		.flatMap((project) => project.tickets)
		.find((view) => view.title === `Ticket ${number}`)?.factoryRun;
}

export async function overviewWhere(
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

/** A run row as the box `laptop` reports it: no source, and `machine` is `local`. */
export function boxRow(hubRow: (typeof hubRuns.runs)[number], kind: string) {
	return {
		...hubRow,
		status: { kind, reason: null },
		source: null,
		rule: null,
		machine: "local",
	};
}

/**
 * A hub, and its box when `boxAnswers` is given, with a tracked repo whose issues
 * the test can change, on a clock the test advances.
 */
export async function serveRuns(
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
	const issues = { numbers: issueNumbers, closed: new Set<number>() };
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
							...ticket(
								number,
								"2026-10-25T09:00:00Z",
								issues.closed.has(number) ? "closed" : "open",
							),
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
			requests.filter((request) => request.url === `${hubUrl}/runs?archived=1`)
				.length,
		eventReads: () =>
			requests.filter((request) => request.url === `${hubUrl}/events`).length,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

export const runPollMs = 10_000;

export async function overviewEventWhere(
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

export async function reportOf(base: string): Promise<ProjectReport> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectReport;
}

export function reportTicket(
	report: ProjectReport,
	number: number,
): TicketView {
	const found = report.tickets.find((view) => view.key === `${repo}#${number}`);
	if (found === undefined) {
		throw new Error(`ticket ${number} is missing from the project`);
	}
	return found;
}

/** A progress comment at stage 3, last updated at `updatedAt`. */
export function progressAt(updatedAt: string): Record<string, unknown>[] {
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
export function hubWith41(kind: string): Answers {
	const [running, ...rest] = hubRuns.runs;
	return {
		...hub,
		"/runs": { runs: [{ ...running, status: { kind } }, ...rest] },
	};
}

export const readyLabel = "ready-for-agent";

export type TrackerWrite = { url: string; body: string };

/** Records each request of the app to a tracker, except a GET and a GraphQL query. */
export function trackerWrites(writes: TrackerWrite[], other: Fetch): Fetch {
	return async (input, init) => {
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? init.body : "";
		const { query } = trackerRequest(input, init);
		if (method !== "GET" && !/^\s*(query\b|\{)/.test(query)) {
			writes.push({ url: urlOf(input), body });
		}
		return other(input, init);
	};
}

/**
 * A hub with the recorded runs, and a tracked repo with the open issues `numbers`.
 * Issue 41 has a running run, and issue 40 a succeeded run. Issue 43 has no run.
 * `hubAnswers` replaces the recorded answers of the hub, and `otherFactory` adds a second factory.
 */
export async function serveGithub(
	numbers: number[],
	options: {
		closed?: number[];
		readyLabel?: string;
		args?: string[];
		labels?: Record<number, string[]>;
		hubAnswers?: Answers;
		otherFactory?: { name: string; url: string; answers: Answers };
	} = {},
) {
	const labels = new Map<number, string[]>(
		Object.entries(options.labels ?? {}).map(([number, names]) => [
			Number(number),
			names,
		]),
	);
	const writes: TrackerWrite[] = [];
	const requests: FactoryRequest[] = [];
	const tracker: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const added = url.match(/\/repos\/acme\/widget\/issues\/(\d+)\/labels$/);
		if (added !== null && init?.method === "POST") {
			const number = Number(added[1]);
			const sent = JSON.parse(String(init.body)) as { labels: string[] };
			labels.set(number, [...(labels.get(number) ?? []), ...sent.labels]);
			return json(
				(labels.get(number) ?? []).map((name) => ({ name })),
				200,
			);
		}
		const listed = issuesResponse(
			input,
			init,
			numbers.map((number) => ({
				...ticket(
					number,
					"2026-10-25T09:00:00Z",
					options.closed?.includes(number) === true ? "closed" : "open",
				),
				labels: labels.get(number) ?? [],
			})),
			repo,
		);
		return listed ?? recordedOrEmpty(url) ?? unrecorded(input, init);
	};
	const app = await serve(
		options.args ?? [],
		{
			pinned: [{ tracker: "github", repo }],
			factories: [
				{
					name: "work hub",
					url: hubUrl,
					...(options.readyLabel === undefined
						? {}
						: { readyLabel: options.readyLabel }),
				},
				...(options.otherFactory === undefined
					? []
					: [
							{
								name: options.otherFactory.name,
								url: options.otherFactory.url,
							},
						]),
			],
		},
		factoryFetch(
			{
				[hubUrl]: options.hubAnswers ?? hub,
				...(options.otherFactory === undefined
					? {}
					: { [options.otherFactory.url]: options.otherFactory.answers }),
			},
			requests,
			trackerWrites(writes, tracker),
		),
		{
			env: { GITHUB_TOKEN: "recorded-token" },
			now: () => new Date(runClockStart),
		},
	);
	return { ...app, writes, requests, labels };
}

export async function ticketWhere(
	base: string,
	project: string,
	key: string,
	accept: (view: TicketView) => boolean,
): Promise<TicketView> {
	while (true) {
		const response = await fetch(
			new URL(`/api/projects/${encodeURIComponent(project)}`, base),
		);
		if (response.ok) {
			const report = (await response.json()) as ProjectReport;
			const view = report.tickets.find((item) => item.key === key);
			if (view !== undefined && accept(view)) {
				return view;
			}
		}
		await Bun.sleep(20);
	}
}

/** `POST /api/run-starts`. A named factory claims the ticket, else the app adds the ready label. */
export function startRun(
	base: string,
	tracker: string,
	project: string,
	key: string,
	factory?: string,
) {
	return fetch(new URL("/api/run-starts", base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			tracker,
			project,
			key,
			...(factory === undefined ? {} : { factory }),
		}),
	});
}
