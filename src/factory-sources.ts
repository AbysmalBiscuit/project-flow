import { z } from "zod";

import type { LinearSource } from "./domain.ts";
import { body, type Read, Unreachable } from "./factory-http.ts";

const linearShown = z.object({
	state: z.string(),
	add: z.array(z.string()),
	remove: z.array(z.string()),
});

/** A ticket that the last source poll did not start, and why it waits. */
const queueEntry = z.object({
	ticket: z.string(),
	waits: z.string(),
	created_at: z.string().nullish(),
});

// A hub that predates the source config serves no `tracker`, `team`, `linear_states` or `rules`.
const sourceConfigs = z.object({
	sources: z.array(
		z.object({
			name: z.string().nullish(),
			tracker: z.string().nullish(),
			repo: z.string().nullish(),
			team: z.string().nullish(),
			// One entry that does not parse drops only itself, so the Linear sources still refresh.
			queue: z
				.array(z.unknown())
				.nullish()
				.transform((entries) =>
					(entries ?? []).flatMap((entry) => {
						const parsed = queueEntry.safeParse(entry);
						return parsed.success ? [parsed.data] : [];
					}),
				),
			linear_states: z.record(z.string(), linearShown).nullish(),
			rules: z
				.array(
					z.object({
						state: z.string(),
						labels: z.array(z.string()),
						without: z.array(z.string()),
					}),
				)
				.nullish(),
		}),
	),
});

const holdList = z.object({
	holds: z.array(
		z.object({
			source: z.string(),
			ticket: z.string(),
			failures: z.number(),
			held_at: z.string(),
		}),
	),
});

/** The budget hold of a ticket of a hub source, from `GET /holds`. */
export type SourceHold = { failures: number; since: string };

/** The waiting tickets of one hub source, in start order. */
export type SourceQueue = {
	source: string;
	tracker: string | null;
	repo: string | null;
	tickets: {
		ticket: string;
		waits: string;
		/** When the ticket was made. Null for a ticket whose comments wait. */
		since: string | null;
		hold?: SourceHold;
	}[];
};

/** What one `GET /sources` of a hub gives: its Linear sources and its queue. */
export type HubSources = { linear: LinearSource[]; queues: SourceQueue[] };

/** The holds by source and ticket. A hub that does not serve or answer `GET /holds` gives none. */
async function holdsOf(read: Read): Promise<Map<string, SourceHold>> {
	try {
		const { holds } = await body(await read("/holds"), holdList);
		return new Map(
			holds.map((hold) => [
				JSON.stringify([hold.source, hold.ticket]),
				{ failures: hold.failures, since: hold.held_at },
			]),
		);
	} catch (error) {
		if (error instanceof Unreachable) {
			return new Map();
		}
		throw error;
	}
}

/** The Linear sources and the queue that the hub `GET /sources` lists, with the holds of `GET /holds`. */
export async function hubSourcesOf(
	read: Read,
	factory: string,
): Promise<HubSources> {
	const { sources } = await body(await read("/sources"), sourceConfigs);
	const waiting = sources.some((source) => source.queue.length > 0);
	const holds = waiting ? await holdsOf(read) : new Map<string, SourceHold>();
	return {
		linear: sources.flatMap(({ tracker, team, linear_states, rules }) =>
			tracker === "linear" && typeof team === "string"
				? [
						{
							factory,
							team,
							linearStates: linear_states ?? {},
							rules: rules ?? [],
						},
					]
				: [],
		),
		queues: sources.flatMap(({ name, tracker, repo, queue }) =>
			typeof name === "string"
				? [
						{
							source: name,
							tracker: tracker ?? null,
							repo: repo ?? null,
							tickets: queue.map((entry) => {
								const hold = holds.get(JSON.stringify([name, entry.ticket]));
								return {
									ticket: entry.ticket,
									waits: entry.waits,
									since: entry.created_at ?? null,
									...(hold === undefined ? {} : { hold }),
								};
							}),
						},
					]
				: [],
		),
	};
}
