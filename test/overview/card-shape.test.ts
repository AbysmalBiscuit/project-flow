import { describe, expect, test } from "bun:test";

import { withServer } from "../support/app.ts";
import { repo } from "../support/github.ts";
import {
	openEventStream,
	overviewOf,
	projectTickets,
	readOverview,
	settledOverview,
	settledOverviewEvent,
} from "../support/reads.ts";
import { githubFetch } from "./_support.ts";

describe("overview cards", () => {
	test("GET /api/overview and the overview event send each card without its tickets", async () => {
		await withServer(githubFetch(), 3600, async (base) => {
			const stream = openEventStream(base);
			await stream.ready;
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const served = await settledOverview(base, readOverview);
			const events = stream.events[Symbol.asyncIterator]();
			const published = await settledOverviewEvent(events, overviewOf);
			stream.close();
			for (const body of [served, published]) {
				const card = body.projects.find((project) => project.name === repo);
				expect(card).toBeDefined();
				expect(card === undefined ? false : "tickets" in card).toBe(false);
				expect(card?.done).toBe(2);
				expect(card?.dropped).toBe(2);
				expect(card?.backlog).toBe(2);
			}
			const tickets = await projectTickets(base, repo);
			expect(tickets.map((ticket) => ticket.key).sort()).toEqual(
				[1, 2, 3, 4, 5, 6].map((number) => `${repo}#${number}`).sort(),
			);
		});
	});
});
