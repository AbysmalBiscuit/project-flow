import { z } from "zod";

import { routeTable } from "./route-table.ts";
import type { RunHistory } from "./run-history.ts";

const queryBody = z.object({ sql: z.string().trim().min(1) });

/**
 * The routes of `/api/insights`: the queryable tables, and one read-only SQL
 * statement over the run history. `recordRuns` brings the history up to date first.
 */
export function insightRoutes(history: RunHistory, recordRuns: () => void) {
	return routeTable({
		"/api/insights": {
			GET: () => Response.json(history.tables()),
		},
		"/api/insights/query": {
			POST: async (request) => {
				const parsed = queryBody.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json(
						{ error: "send one SQL statement as sql" },
						{ status: 400 },
					);
				}
				recordRuns();
				const result = history.query(parsed.data.sql);
				return Response.json(result, { status: "error" in result ? 400 : 200 });
			},
		},
	});
}
