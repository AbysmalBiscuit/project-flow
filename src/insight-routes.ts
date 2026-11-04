import { z } from "zod";

import type { Clock } from "./ports.ts";
import { routeTable } from "./route-table.ts";
import type { RunHistory } from "./run-history.ts";
import type { SavedInsightStore } from "./saved-insights.ts";

const queryBody = z.object({ sql: z.string().trim().min(1) });

const savedBody = z.object({
	name: z.string().trim().min(1),
	sql: z.string().trim().min(1),
});

const savedPatch = savedBody
	.partial()
	.refine((patch) => patch.name !== undefined || patch.sql !== undefined);

const savedId = z.coerce.number().int().positive();

const notFound = () =>
	Response.json({ error: "no such saved query" }, { status: 404 });

async function bodyOf<T>(
	request: Request,
	schema: z.ZodType<T>,
): Promise<T | null> {
	const parsed = schema.safeParse(await request.json().catch(() => null));
	return parsed.success ? parsed.data : null;
}

/**
 * The routes of `/api/insights`: the queryable tables, one read-only SQL
 * statement over the run history, and the saved queries.
 */
export function insightRoutes(
	history: RunHistory,
	saved: SavedInsightStore,
	/** Brings the run history up to date before a query. */
	recordRuns: () => void,
	clock: Clock,
) {
	return routeTable({
		"/api/insights": {
			GET: () => Response.json(history.tables()),
		},
		"/api/insights/query": {
			POST: async (request) => {
				const body = await bodyOf(request, queryBody);
				if (body === null) {
					return Response.json(
						{ error: "send one SQL statement as sql" },
						{ status: 400 },
					);
				}
				recordRuns();
				const result = history.query(body.sql);
				return Response.json(result, { status: "error" in result ? 400 : 200 });
			},
		},
		"/api/insights/saved": {
			GET: () => Response.json(saved.list()),
			POST: async (request) => {
				const body = await bodyOf(request, savedBody);
				if (body === null) {
					return Response.json(
						{ error: "send a name and a SQL statement as name and sql" },
						{ status: 400 },
					);
				}
				return Response.json(saved.save(body.name, body.sql), { status: 201 });
			},
		},
		"/api/insights/saved/:id": {
			PATCH: async (request) => {
				const id = savedId.safeParse(request.params.id);
				if (!id.success) {
					return notFound();
				}
				const patch = await bodyOf(request, savedPatch);
				if (patch === null) {
					return Response.json(
						{ error: "send a new name or SQL statement as name or sql" },
						{ status: 400 },
					);
				}
				const changed = saved.change(id.data, patch);
				return changed === null ? notFound() : Response.json(changed);
			},
			DELETE: (request) => {
				const id = savedId.safeParse(request.params.id);
				return id.success && saved.remove(id.data, clock.now().toISOString())
					? new Response(null, { status: 204 })
					: notFound();
			},
		},
	});
}
