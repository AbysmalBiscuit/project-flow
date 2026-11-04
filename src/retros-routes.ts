import { endedRunStatusKinds } from "./kinds.ts";
import type { Clock, FactoryReader } from "./ports.ts";
import {
	retroDetail,
	retrosPage,
	type RunRetro,
	smoothness,
} from "./retros-page.ts";
import { routeTable } from "./route-table.ts";
import type { RunHistory } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";

const thirtyDaysMs = 30 * 24 * 60 * 60 * 1_000;

const ended: ReadonlySet<string> = new Set(endedRunStatusKinds);

export type RetrosRouteOptions = {
	factories: Pick<FactoryReader, "retro">;
	history: RunHistory;
	clock: Clock;
	runList: () => RunListRow[];
	/** Bring the run history up to date with the run list. */
	recordRuns: () => void;
};

/** The routes of the Retros tab: the retros of the last 30 days, and the retro of one run. */
export function retrosRoutes(options: RetrosRouteOptions) {
	return routeTable({
		"/api/retros": {
			GET: (request) => {
				options.recordRuns();
				// `?atLeast=rough` keeps the runs that went rough or worse.
				const atLeast = smoothness
					.nullable()
					.catch(null)
					.parse(new URL(request.url).searchParams.get("atLeast"));
				const since = new Date(options.clock.now().getTime() - thirtyDaysMs);
				return Response.json(
					retrosPage(
						options.history.retrosSince(since),
						options.history.retroNotServed(),
						atLeast,
					),
				);
			},
		},
		"/api/retros/runs/:id": {
			GET: async (request) => {
				const id = request.params.id;
				const listed = options.runList().find((run) => run.id === id);
				const row =
					listed === undefined
						? options.history.runOf(id)
						: { ticket: listed.key, result: listed.result ?? null };
				// A run with no stored retro reads its factory. An ended run keeps the answer,
				// so a factory that serves the route after an update fills the list run by run.
				const stored = options.history.retroOf(id);
				const retro =
					stored === null || stored === "not served"
						? await options.factories.retro(id)
						: stored;
				if (
					stored !== retro &&
					retro !== null &&
					retro !== "not served" &&
					listed !== undefined &&
					ended.has(listed.statusKind)
				) {
					options.history.recordRetro(id, listed.endedAt, retro);
				}
				const answer: RunRetro = {
					id,
					ticket: row?.ticket ?? null,
					result: row?.result ?? null,
					retro:
						retro === null || retro === "not served"
							? null
							: retroDetail(retro, options.history.stageTimes(id)),
					notServed: retro === "not served",
				};
				return Response.json(answer);
			},
		},
	});
}
