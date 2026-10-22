import type { PollProgress } from "../src/domain.ts";
import type { ChangeEvent } from "./support.ts";

export function eventsOf(text: string): ChangeEvent[] {
	const events: ChangeEvent[] = [];
	for (const block of text.split("\n\n")) {
		const event = block
			.split("\n")
			.find((line) => line.startsWith("event:"))
			?.slice("event:".length)
			.trim();
		const payload = block
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).trim())
			.join("\n");
		if (event !== undefined && payload !== "") {
			events.push({ event, data: payload });
		}
	}
	return events;
}

// Wait for a progress start after the stream opens, then that poll's end.
// A replayed or in-flight poll's ended event is not this refresh.
export async function refreshSettled(base: string): Promise<void> {
	const stream = await fetch(new URL("/api/events", base), {
		headers: { accept: "text/event-stream" },
	});
	const reader = stream.body?.getReader();
	if (reader === undefined) {
		throw new Error("event stream has no body");
	}
	const decoder = new TextDecoder();
	let buffered = "";
	try {
		const opened = await reader.read();
		buffered += decoder.decode(opened.value, { stream: true });
		if (!buffered.includes(": open")) {
			throw new Error("event stream did not open");
		}
		const refreshed = await fetch(new URL("/api/refresh", base), {
			method: "POST",
		});
		if (refreshed.status !== 204) {
			throw new Error(`refresh returned ${refreshed.status}`);
		}
		const postedAt = buffered.length;
		const progressOf = (event: ChangeEvent): PollProgress | null => {
			if (event.event !== "progress") {
				return null;
			}
			return JSON.parse(event.data) as PollProgress;
		};
		const ownPollSettled = (text: string): boolean => {
			const progress = eventsOf(text.slice(postedAt))
				.map(progressOf)
				.filter((item) => item !== null);
			const started = progress.findIndex(
				(item) => item.done === 0 && item.ended === false,
			);
			return (
				started >= 0 &&
				progress.slice(started).some((item) => item.ended === true)
			);
		};
		while (!ownPollSettled(buffered)) {
			const chunk = await reader.read();
			if (chunk.done) {
				throw new Error("event stream closed before the poll ended");
			}
			buffered += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		await reader.cancel();
	}
}

// Read an event stream in quiet-separated batches. A read that outlasts one
// batch carries over to the next, so no chunk is lost.
export function quietReader(reader: ReadableStreamDefaultReader<Uint8Array>): {
	untilIdle: (idleMs?: number) => Promise<string>;
} {
	const decoder = new TextDecoder();
	let pending: ReturnType<typeof reader.read> | null = null;
	return {
		async untilIdle(idleMs = 300) {
			let text = "";
			for (;;) {
				pending ??= reader.read();
				const chunk = await Promise.race([
					pending,
					Bun.sleep(idleMs).then(() => null),
				]);
				if (chunk === null) {
					return text;
				}
				pending = null;
				if (chunk.done) {
					return text;
				}
				text += decoder.decode(chunk.value, { stream: true });
			}
		},
	};
}
