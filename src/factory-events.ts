import { z } from "zod";

import { runRow } from "./factory-run-rows.ts";

/** One frame of the hub's `GET /events`: a box event of a run, or a status change. */
const eventFrame = z.object({
	run_id: z.string(),
	item: z
		.object({ event: z.string(), node_path: z.string(), data: z.unknown() })
		.optional(),
	recorded_at: z.string().optional(),
	status: runRow.shape.status.optional(),
});

export type EventFrame = z.infer<typeof eventFrame>;

/** The `data` of a `steer.delivered` event. */
export const deliveredSteer = z.object({
	steer: z.union([z.number(), z.string()]).transform(String),
	sender: z.string(),
	text: z.string(),
	delivered_at: z.string(),
});

/**
 * The event stream of one factory: connecting, open, closed since a time, or
 * "none" for a factory that answers 404 on `GET /events`.
 */
export type Follow = "connecting" | "open" | "none" | { closedAt: number };

export const streamRetryMs = 10_000;

/** The hub sends no frame for a queued run and no run times, so a streamed factory keeps this `GET /runs` read. */
export const streamedRunPollMs = 60_000;

/**
 * The current node of a run after one event. A finished node hands the run back
 * to the node of the child graph that holds it.
 */
export function nodeAfter(
	current: string | undefined,
	event: string,
	nodePath: string,
): string | undefined {
	if (event === "stage.started") {
		return nodePath;
	}
	const finished = event === "stage.completed" || event === "stage.failed";
	if (
		!finished ||
		current === undefined ||
		(current !== nodePath && !current.startsWith(`${nodePath}/`))
	) {
		return current;
	}
	const parent = nodePath.split("/").slice(0, -1).join("/");
	return parent === "" ? undefined : parent;
}

function jsonOrNull(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** The frames of an SSE body. A frame that does not parse is left out. */
export async function* eventFrames(body: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const bytes of body) {
		buffer += decoder.decode(bytes, { stream: true }).replaceAll("\r\n", "\n");
		const blocks = buffer.split("\n\n");
		buffer = blocks.pop() ?? "";
		for (const block of blocks) {
			const data = block
				.split("\n")
				.flatMap((line) =>
					line.startsWith("data:") ? [line.slice("data:".length).trim()] : [],
				)
				.join("\n");
			const parsed = eventFrame.safeParse(jsonOrNull(data));
			if (parsed.success) {
				yield parsed.data;
			}
		}
	}
}
