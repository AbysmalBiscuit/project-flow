import {
	factoriesPage,
	factoryCheckMs,
	outcomeDays,
	stageDays,
} from "./factories-page.ts";
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

export type FactoriesRouteOptions = {
	factories: FactoryReader;
	history: RunHistory;
	clock: Clock;
	runList: () => RunListRow[];
	ticketUrls: () => ReadonlyMap<string, string>;
	/** Bring the run history up to date with the run list. */
	recordRuns: () => void;
	/** Check each factory again: `GET /daemon`, and `GET /sources` and `GET /holds` of each hub. */
	checkFactories: () => void;
};

/** The route of the Factories tab. A read checks the factories again when the last check is old. */
export function factoriesRoutes(options: FactoriesRouteOptions) {
	let checkedAt: number | null = null;
	return routeTable({
		"/api/factories": {
			GET: () => {
				const now = options.clock.now();
				if (checkedAt === null || now.getTime() - checkedAt >= factoryCheckMs) {
					checkedAt = now.getTime();
					options.checkFactories();
				}
				options.recordRuns();
				const stagesSince = new Date(now.getTime() - stageDays * dayMs);
				return Response.json(
					factoriesPage({
						entries: options.factories.entries(),
						floor: options.factories.floor(),
						runs: options.factories.runs(),
						rows: options.runList(),
						ended: options.history.endedSince(dayStart(now, outcomeDays - 1)),
						stageSamples: options.history.stageSamples(stagesSince),
						stageCosts: options.history.stageCosts(stagesSince),
						ticketUrls: options.ticketUrls(),
						now,
					}),
				);
			},
		},
	});
}
