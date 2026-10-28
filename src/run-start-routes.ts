import { z } from "zod";

import type { Configuration } from "./configuration.ts";
import { trackers } from "./domain.ts";
import { type PollOptions, runningOverview } from "./poll.ts";
import type { Notifier } from "./ports.ts";
import { ticketSnapshot } from "./replies.ts";
import { routeTable } from "./route-table.ts";
import { runStartOf } from "./run-start.ts";
import { sameTicketKey } from "./ticket-key.ts";
import { trackerError, trackerFor, type Trackers } from "./tracker-route.ts";
import { runFor } from "./workcell.ts";

const startBody = z.object({
	tracker: z.enum(trackers),
	project: z.string().trim().min(1),
	key: z.string().trim().min(1),
});

export type RunStartRouteOptions = {
	trackers: Trackers;
	pollOptions: PollOptions;
	notifier: Notifier;
	configuration: () => Configuration;
};

/** `POST /api/run-starts`: add the ready label of a factory to a ticket, so the hub starts a run of it. */
export function runStartRoutes({
	trackers,
	pollOptions,
	notifier,
	configuration,
}: RunStartRouteOptions) {
	return routeTable({
		"/api/run-starts": {
			POST: async (request) => {
				const parsed = startBody.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json({ error: "invalid run start" }, { status: 400 });
				}
				const target = parsed.data;
				const row = ticketSnapshot(pollOptions.store.readTickets(), target);
				const ticket = row?.tickets.find(
					(item) => item.key !== null && sameTicketKey(item.key, target.key),
				);
				if (row === undefined || ticket === undefined) {
					return Response.json({ error: "ticket not found" }, { status: 404 });
				}
				const start = runStartOf(
					ticket,
					runFor(ticket, pollOptions.factoryRuns()),
					configuration().factories,
				);
				if ("refused" in start) {
					return Response.json({ error: start.refused }, { status: 409 });
				}
				if (start.requested === true) {
					return Response.json(
						{ error: "the run is already requested" },
						{ status: 409 },
					);
				}
				const tracker = trackerFor(trackers, target.tracker);
				if (tracker?.addLabel === undefined) {
					return Response.json(
						{ error: "tracker unavailable" },
						{ status: 404 },
					);
				}
				try {
					await tracker.addLabel(target.key, start.label);
				} catch (error) {
					return trackerError(error);
				}
				pollOptions.store.mergeTickets([
					{
						...row,
						tickets: row.tickets.map((item) =>
							item === ticket
								? { ...item, labels: [...item.labels, start.label] }
								: item,
						),
					},
				]);
				notifier.publish({
					overview: runningOverview(pollOptions, configuration()),
					notifications: [],
				});
				return Response.json({ factory: start.factory, label: start.label });
			},
		},
	});
}
