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
	linearTicket("WID-2", "Paint the rows", "unstarted", "WID-1"),
	linearTicket("WID-3", "Paint the cells", "completed", "WID-2"),
	linearTicket("WID-4", "Size the cells", "unstarted", "WID-2"),
	linearTicket("WID-10", "Move the archive", "unstarted", null),
	linearTicket("WID-11", "Copy the archive", "completed", "WID-10"),
	linearTicket("WID-12", "Check the copied files", "unstarted", "WID-11"),
	linearTicket("WID-20", "Write the runbook", "unstarted", null),
];

const graphOf = async (search: string) => {
	let found: {
		shown: (string | null)[];
		parents: (string | null)[];
		done: Record<string, string>;
	} = { shown: [], parents: [], done: {} };
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
			found = {
				shown: report.graphTickets.map((ticket) => ticket.key).sort(),
				parents: report.graphParents.map((ticket) => ticket.key).sort(),
				done: Object.fromEntries(
					[...report.graphTickets, ...report.graphParents].flatMap((ticket) =>
						ticket.subTickets === undefined
							? []
							: [
									[
										ticket.key ?? "",
										`${ticket.subTicketsDone ?? 0}/${ticket.subTickets}`,
									],
								],
					),
				),
			};
		},
	);
	return found;
};

describe("GET /api/projects/:name graph parent tickets", () => {
	test("a done parent ticket of a shown sub-ticket heads its frame", async () => {
		expect(await graphOf("")).toEqual({
			shown: ["WID-1", "WID-10", "WID-12", "WID-2", "WID-20", "WID-4"],
			parents: ["WID-11"],
			done: {
				"WID-1": "0/1",
				"WID-2": "1/2",
				"WID-10": "1/1",
				"WID-11": "0/1",
			},
		});
	});

	test("a search that hides the parent tickets of a shown sub-ticket keeps them as frame heads", async () => {
		expect(await graphOf("size")).toEqual({
			shown: ["WID-4"],
			parents: ["WID-1", "WID-2"],
			done: { "WID-1": "0/1", "WID-2": "1/2" },
		});
	});

	test("a parent ticket whose sub-tickets are all hidden heads no frame", async () => {
		expect(await graphOf("runbook")).toEqual({
			shown: ["WID-20"],
			parents: [],
			done: {},
		});
	});
});
