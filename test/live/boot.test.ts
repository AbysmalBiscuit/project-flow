import { describe, expect, test } from "bun:test";

import { withServer } from "../support/app.ts";
import { openEventStream } from "../support/reads.ts";
import { unchangedFetch } from "./_support.ts";

async function firstEvent(
	base: string,
): Promise<{ event: string; data: string }> {
	const stream = openEventStream(base);
	try {
		for await (const event of stream.events) {
			return event;
		}
		throw new Error("event stream closed before its first event");
	} finally {
		stream.close();
	}
}

async function bootsOf(): Promise<string[]> {
	const boots: string[] = [];
	await withServer(unchangedFetch([]), 60, async (base) => {
		for (const _ of [1, 2]) {
			const event = await firstEvent(base);
			expect(event.event).toBe("boot");
			boots.push(event.data);
		}
	});
	return boots;
}

describe("boot event", () => {
	test("each stream opens with the boot id of the server process", async () => {
		const [first, reconnected] = await bootsOf();
		const [restarted] = await bootsOf();
		expect(first).toBeString();
		expect(reconnected).toBe(first);
		expect(restarted).not.toBe(first);
	});
});
