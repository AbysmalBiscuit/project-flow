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
