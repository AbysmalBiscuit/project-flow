import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../src/domain.ts";
import { linearSlug, withApp } from "./project-harness.ts";
import { linearFake } from "./support.ts";

const linearTicket = (
	id: string,
	title: string,
	state: "unstarted" | "completed",
	parent: string | null,
) => ({
	id,
	identifier: id,
	title,
	description: "",
	state: { type: state },
	updatedAt: "2026-10-21T12:00:00.000Z",
	projectMilestone: { name: "Beta" },
	labels: { nodes: [] },
	parent: parent === null ? null : { identifier: parent },
});

const issues = [
	linearTicket("WID-1", "Paint the list", "unstarted", null),
	linearTicket("WID-2", "Paint the rows", "completed", "WID-1"),
	linearTicket("WID-3", "Paint the cells", "completed", "WID-1"),
	linearTicket("WID-4", "Paint the borders", "completed", "WID-3"),
	linearTicket("WID-10", "Paint the archive", "unstarted", null),
	linearTicket("WID-11", "Paint the copies", "completed", "WID-10"),
	linearTicket("WID-12", "Check the copied files", "unstarted", "WID-11"),
];

const startsCollapsed = async (search: string) => {
	let found: Record<string, boolean> = {};
	await withApp(
		JSON.stringify({
			pinned: [{ tracker: "linear", project: linearSlug }],
			projectViews: { "Widget launch": { search } },
		}),
		linearFake({
			project: {
				id: "project-widget",
				name: "Widget launch",
				slugId: linearSlug,
			},
			issues,
		}),
		{ LINEAR_API_KEY: "recorded-linear-key" },
		async (base) => {
			const report = (await (
				await fetch(new URL("/api/projects/Widget%20launch", base))
			).json()) as ProjectReport;
			found = Object.fromEntries(
				[...report.tickets, ...report.doneTickets].map((ticket) => [
					ticket.key,
					ticket.startsCollapsed === true,
				]),
			);
		},
	);
	return found;
};

describe("GET /api/projects/:name", () => {
	test("a parent ticket starts collapsed when every descendant is done", async () => {
		expect(await startsCollapsed("")).toEqual({
			"WID-1": true,
			"WID-2": false,
			"WID-3": true,
			"WID-4": false,
			"WID-10": false,
			"WID-11": false,
			"WID-12": false,
		});
	});

	test("a search that hides an open sub-ticket keeps its parent ticket open", async () => {
		expect(await startsCollapsed("paint")).toEqual({
			"WID-1": true,
			"WID-2": false,
			"WID-3": true,
			"WID-4": false,
			"WID-10": false,
			"WID-11": false,
		});
	});
});
