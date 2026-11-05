import { z } from "zod";

import {
	factoriesPage,
	factoryCheckMs,
	outcomeDays,
	type RangeDays,
	rangeDays,
	stageDays,
	type StageWindow,
} from "./factories-page.ts";
import { growthSpanMs } from "./host-health.ts";
import type { Clock, FactoryReader } from "./ports.ts";
import { routeTable } from "./route-table.ts";
import type { RunHistory } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";

const dayMs = 24 * 60 * 60 * 1_000;

/** The start of the UTC day `days` days before `now`. */
function dayStart(now: Date, days: number): Date {
	const start = new Date(now.getTime() - days * dayMs);
	start.setUTCHours(0, 0, 0, 0);
	return start;
}

const range = z.coerce
	.number()
	.pipe(z.union(rangeDays.map((days) => z.literal(days))));

/** The day range a query parameter picks, or `fallback` when it picks no offered range. */
function rangeParam(url: URL, name: string, fallback: RangeDays): RangeDays {
	return range.catch(fallback).parse(url.searchParams.get(name) ?? fallback);
}

export type FactoriesRouteOptions = {
	factories: FactoryReader;
	history: RunHistory;
	clock: Clock;
	runList: () => RunListRow[];
	ticketUrls: () => ReadonlyMap<string, string>;
	/** Bring the run history up to date with the run list. */
	recordRuns: () => void;
	/** Check each factory again: `GET /daemon`, and `GET /sources`, `GET /holds` and `GET /machines/pool` of each hub. */
	checkFactories: () => void;
};

/**
 * The route of the Factories tab. A read checks the factories again when the last check is old.
 * `?outcomeDays=` and `?stageDays=` pick the days of the outcome chart and the stage durations.
 */
export function factoriesRoutes(options: FactoriesRouteOptions) {
	let checkedAt: number | null = null;
	const stagesOver = (now: Date, days: number): StageWindow => {
		const since = new Date(now.getTime() - days * dayMs);
		return {
			samples: options.history.stageSamples(since),
			costs: options.history.stageCosts(since),
		};
	};
	return routeTable({
		"/api/factories": {
			GET: (request) => {
				const now = options.clock.now();
				if (checkedAt === null || now.getTime() - checkedAt >= factoryCheckMs) {
					checkedAt = now.getTime();
					options.checkFactories();
				}
				options.recordRuns();
				const url = new URL(request.url);
				const outcomes = rangeParam(url, "outcomeDays", outcomeDays);
				const stages = rangeParam(url, "stageDays", stageDays);
				const stall = stagesOver(now, stageDays);
				return Response.json(
					factoriesPage({
						entries: options.factories.entries(),
						floor: options.factories.floor(),
						runs: options.factories.runs(),
						rows: options.runList(),
						ended: options.history.endedSince(dayStart(now, outcomes - 1)),
						outcomeDays: outcomes,
						stall,
						shown: stages === stageDays ? stall : stagesOver(now, stages),
						hostSamples: options.history.hostSamples(
							new Date(now.getTime() - growthSpanMs),
						),
						ticketUrls: options.ticketUrls(),
						now,
					}),
				);
			},
		},
	});
}
