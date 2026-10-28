import { expect } from "bun:test";

import type { ShownFactoryRun, TicketView } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import type hubRuns from "../fixtures/factory-hub-runs.json";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hubUrl,
	laptopUrl,
	readOrRunWrite,
	serve,
} from "../support/factory.ts";
import { json, urlOf } from "../support/fetch.ts";
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
			requests.filter((request) => request.url === `${hubUrl}/runs`).length,
		eventReads: () =>
			requests.filter((request) => request.url === `${hubUrl}/events`).length,
		advance: (ms: number) => {
			now += ms;
		},
	};
}
