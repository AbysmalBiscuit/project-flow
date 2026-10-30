import { z } from "zod";

import type { LinearSource } from "./domain.ts";
import { body, type Read } from "./factory-http.ts";

const linearShown = z.object({
	state: z.string(),
	add: z.array(z.string()),
	remove: z.array(z.string()),
});

// A hub that predates the source config serves no `tracker`, `team`, `linear_states` or `rules`.
const sourceConfigs = z.object({
	sources: z.array(
		z.object({
			tracker: z.string().nullish(),
			team: z.string().nullish(),
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

/** The Linear sources that the hub `GET /sources` lists with their config. */
export async function linearSourcesOf(
	read: Read,
	factory: string,
): Promise<LinearSource[]> {
	const { sources } = await body(await read("/sources"), sourceConfigs);
	return sources.flatMap(({ tracker, team, linear_states, rules }) =>
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
	);
}
