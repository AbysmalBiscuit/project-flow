import { z } from "zod";

import type { RunEventsEnd, RunLogEvent } from "./domain.ts";
import { sseFrames } from "./factory-events.ts";
import { reader, Unreachable } from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";

/** One event of `GET /runs/{id}/events`. */
const runEventFrame = z.object({
	id: z.string(),
	recorded_at: z.string(),
	item: z.object({
		event: z.string(),
		node_path: z.string(),
		data: z.unknown(),
	}),
});

/**
 * The event stream of one run, as server-sent events: every event of the run,
 * then its new events, then an `end` event. The hub that reports a run streams
 * the events of a run on a box. A `lastEventId` starts the stream after that event.
 */
export function runEventsReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const { fetchImpl, signal, statusRowOf } = deps;
	return (
		runId: string,
		lastEventId: string | null,
		client: AbortSignal,
	): Response | null => {
		const { hubRow, row } = statusRowOf(runId);
		const target = hubRow ?? row;
		if (target === undefined) {
			return null;
		}
		const read = reader(
			fetchImpl,
			target.url,
			AbortSignal.any([signal, client]),
			null,
		);
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				const send = (text: string) => controller.enqueue(encoder.encode(text));
				send(": open\n\n");
				const end = (reason: RunEventsEnd["reason"]) => {
					send(
						`event: end\ndata: ${JSON.stringify({ reason } satisfies RunEventsEnd)}\n\n`,
					);
					controller.close();
				};
				let response: Response;
				try {
					response = await read(`/runs/${encodeURIComponent(runId)}/events`, {
						headers:
							lastEventId === null ? {} : { "last-event-id": lastEventId },
					});
				} catch (error) {
					if (!(error instanceof Unreachable) || client.aborted) {
						return;
					}
					end("unreachable");
					return;
				}
				if (response.status === 404) {
					end("not served");
					return;
				}
				if (!response.ok || response.body === null) {
					end("unreachable");
					return;
				}
				try {
					for await (const frame of sseFrames(response.body, runEventFrame)) {
						const event: RunLogEvent = {
							id: frame.id,
							event: frame.item.event,
							stage: frame.item.node_path,
							at: frame.recorded_at,
							data: frame.item.data,
						};
						send(`id: ${frame.id}\ndata: ${JSON.stringify(event)}\n\n`);
					}
				} catch {
					if (client.aborted) {
						return;
					}
					end("unreachable");
					return;
				}
				end("ended");
			},
		});
		return new Response(body, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
			},
		});
	};
}
