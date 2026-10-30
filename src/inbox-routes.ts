import { z } from "zod";

import { inboxEntries } from "./inbox-entries.ts";
import type { Clock, Store } from "./ports.ts";
import { routeTable } from "./route-table.ts";

const readMarkBody = z.object({ read: z.literal(true) });

const readIdsBody = readMarkBody.extend({
	ids: z.array(z.string()),
});

async function readMark(request: Request): Promise<boolean> {
	const parsed = readMarkBody.safeParse(await request.json().catch(() => null));
	return parsed.success;
}

/** The routes of `/api/inbox`: the notifications, and the marks that read them. */
export function inboxRoutes(store: Store, clock: Clock) {
	return routeTable({
		"/api/inbox": {
			GET: () =>
				Response.json(inboxEntries(store.readNotifications(), clock.now())),
			POST: async (request: Request) => {
				const parsed = readIdsBody.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json({ error: "read must be true" }, { status: 400 });
				}
				store.markNotificationsRead(parsed.data.ids);
				return new Response(null, { status: 204 });
			},
		},
		"/api/inbox/:id": {
			POST: async (request) => {
				const marked = await readMark(request);
				if (!marked) {
					return Response.json({ error: "read must be true" }, { status: 400 });
				}
				const id = request.params.id.trim();
				if (id === "") {
					return Response.json(
						{ error: "notification id is blank" },
						{ status: 400 },
					);
				}
				if (!store.markNotificationRead(id)) {
					return Response.json(
						{ error: "notification not found" },
						{ status: 404 },
					);
				}
				return new Response(null, { status: 204 });
			},
		},
	});
}
