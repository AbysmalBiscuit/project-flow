import { z } from "zod";

import { body, type Read } from "./factory-http.ts";
import { localMachine } from "./factory-run-rows.ts";

export type FactoryKind = "hub" | "daemon";

export const about = z.object({ role: z.enum(["hub", "daemon"]).optional() });

const sources = z.object({ sources: z.array(z.unknown()) });

const runs = z.object({
	runs: z.array(z.object({ machine: z.string().nullish() })),
});

export async function factoryKind(
	read: Read,
	role: FactoryKind | undefined,
): Promise<FactoryKind> {
	if (role !== undefined) {
		return role;
	}
	const response = await read("/sources");
	if (response.status === 404) {
		return "daemon";
	}
	// A daemon without hub sources answers `/sources` with an empty list.
	const listed = await body(response, sources);
	return listed.sources.length > 0 ? "hub" : "daemon";
}

export async function boxCount(read: Read): Promise<number> {
	const listed = await body(await read("/runs"), runs);
	const machines = listed.runs.flatMap(({ machine }) =>
		machine === null || machine === undefined || machine === localMachine
			? []
			: [machine],
	);
	return new Set(machines).size;
}
