import { z } from "zod";

import type { Configuration } from "./configuration.ts";
import { type Ticket, trackers } from "./domain.ts";
import { type PollOptions, runningOverview } from "./poll.ts";
import type { Clock, FactoryReader, Notifier } from "./ports.ts";
import { ticketSnapshot } from "./replies.ts";
import { routeTable } from "./route-table.ts";
import { runStartOf, type StartKind, startRefusal } from "./run-start.ts";
import { foldKey, githubKeyParts, sameTicketKey } from "./ticket-key.ts";
import { trackerError, trackerFor, type Trackers } from "./tracker-route.ts";
import { runFor, runsFor } from "./workcell.ts";

const startBody = z.object({
	tracker: z.enum(trackers),
	project: z.string().trim().min(1),
	key: z.string().trim().min(1),
	/** The factory that claims the ticket. Without it, the app adds the ready label of the first factory that has one. */
	factory: z.string().trim().min(1).optional(),
});

/** An error answer to a claimed start, with the reason of the factory when it gives one. */
function claimError(
	text: string,
	reason: string | undefined,
	status: number,
): Response {
	return Response.json(
		{ error: reason === undefined ? text : `${text}: ${reason}` },
		{ status },
	);
}

export type RunStartRouteOptions = {
	trackers: Trackers;
	pollOptions: PollOptions;
	notifier: Notifier;
	configuration: () => Configuration;
	factories: FactoryReader;
	clock: Clock;
	readFactories: (read: () => Promise<void>) => Promise<void>;
};

/**
 * `POST /api/run-starts`: add the ready label of a factory to a ticket, so the hub starts a run of it.
 * A body that names a factory sends a claimed start to that factory instead.
 */
export function runStartRoutes({
	trackers,
	pollOptions,
	notifier,
	configuration,
	factories,
	clock,
	readFactories,
}: RunStartRouteOptions) {
	/** A start that the app sent, so the ticket shows the run as requested until it starts. */
	const recordRequest = (key: string, kind: StartKind) => {
		pollOptions.runStartRequests = new Map([
			...pollOptions.runStartRequests,
			[foldKey(key), { at: pollOptions.clock.now().toISOString(), ...kind }],
		]);
	};
	/** `POST /runs` with `claim: true` to the named factory, which starts the run now or queues it. */
	const claimed = async (ticket: Ticket, key: string, name: string) => {
		const newestRun = runFor(ticket, pollOptions.factoryRuns());
		const refused = startRefusal(ticket, newestRun);
		if (refused !== undefined) {
			return Response.json({ error: refused }, { status: 409 });
		}
		const labelStart = runStartOf(ticket, newestRun, {
			factories: pollOptions.listedFactories(),
			requests: pollOptions.runStartRequests,
		});
		if (!("refused" in labelStart) && labelStart.requested === true) {
			return Response.json(
				{ error: "the run is already requested" },
				{ status: 409 },
			);
		}
		const factory = pollOptions
			.listedFactories()
			.find((item) => item.name === name);
		if (factory === undefined) {
			return Response.json({ error: "factory not found" }, { status: 404 });
		}
		const parts = githubKeyParts(key);
		if (parts === null) {
			return Response.json(
				{ error: "a claimed start needs a GitHub ticket" },
				{ status: 409 },
			);
		}
		const result = await factories.claimStart(factory.url, {
			repo: parts.repo,
			ticket: String(parts.number),
		});
		if ("claimed" in result) {
			recordRequest(key, {
				claim: true,
				run: result.claimed,
				known: runsFor(ticket, pollOptions.factoryRuns()).map(({ id }) => id),
			});
			await readFactories(() => factories.readRuns(clock.now().getTime()));
			notifier.publish({
				overview: runningOverview(pollOptions, configuration()),
				notifications: [],
			});
			return Response.json({ factory: name });
		}
		if ("refused" in result) {
			return claimError(`${name} refused the start`, result.refused, 409);
		}
		if ("unmatched" in result) {
			return claimError(
				`${name} has no source for ${parts.repo}`,
				result.unmatched,
				422,
			);
		}
		return claimError(`${name} did not take the start`, result.failed, 502);
	};
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
				if (target.factory !== undefined) {
					return claimed(ticket, ticket.key ?? target.key, target.factory);
				}
				const start = runStartOf(
					ticket,
					runFor(ticket, pollOptions.factoryRuns()),
					{
						factories: pollOptions.listedFactories(),
						requests: pollOptions.runStartRequests,
					},
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
				if (start.label === undefined) {
					return Response.json(
						{ error: "no factory has a ready label" },
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
				recordRequest(target.key, { claim: false });
				const label = start.label.toLowerCase();
				if (!ticket.labels.some((item) => item.toLowerCase() === label)) {
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
				}
				notifier.publish({
					overview: runningOverview(pollOptions, configuration()),
					notifications: [],
				});
				return Response.json({ factory: start.factory, label: start.label });
			},
		},
	});
}
