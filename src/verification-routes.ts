import type { Clock, FactoryReader } from "./ports.ts";
import { routeTable } from "./route-table.ts";
import type { RunHistory } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";
import {
	type RunVerification,
	verificationPage,
	verificationRounds,
} from "./verification-page.ts";

const thirtyDaysMs = 30 * 24 * 60 * 60 * 1_000;

export type VerificationRouteOptions = {
	factories: Pick<FactoryReader, "verification">;
	history: RunHistory;
	clock: Clock;
	runList: () => RunListRow[];
	/** Bring the run history up to date with the run list. */
	recordRuns: () => void;
};

/**
 * The routes of the Verification tab: the records of the last 30 days across runs,
 * and the record of one run. A run with no stored record reads its factory, so a factory that
 * serves the route after an update answers for its older runs too.
 */
export function verificationRoutes(options: VerificationRouteOptions) {
	return routeTable({
		"/api/verification": {
			GET: () => {
				options.recordRuns();
				const since = new Date(options.clock.now().getTime() - thirtyDaysMs);
				return Response.json(
					verificationPage(
						options.history.verifiedSince(since),
						options.history.verificationNotServed(),
					),
				);
			},
		},
		"/api/verification/runs/:id": {
			GET: async (request) => {
				const id = request.params.id;
				const listed = options.runList().find((run) => run.id === id);
				const row =
					listed === undefined
						? options.history.runOf(id)
						: { ticket: listed.key, result: listed.result ?? null };
				const stored = options.history.verificationOf(id);
				const record =
					stored === null || stored === "not served"
						? await options.factories.verification(id)
						: stored;
				const answer: RunVerification = {
					id,
					ticket: row?.ticket ?? null,
					result: row?.result ?? null,
					rounds:
						record === null || record === "not served"
							? []
							: verificationRounds(record),
					notServed: record === "not served",
				};
				return Response.json(answer);
			},
		},
	});
}
