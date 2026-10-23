/**
 * Serves an `api-kysely cleanup followup` Linear project whose sub-tickets sit
 * under parent tickets from other projects, beside the tracked `API platform`
 * project that holds one of those parent tickets.
 *
 * Usage: bun proof/serve-355.ts [PORT]
 */
import type { Fetch } from "../src/fetch.ts";
import { linearFake } from "../test/support.ts";
import { type StateName, stateOf, teamStates } from "./linear-states.ts";
import { serveRecorded } from "./recorded.ts";

const followup = {
	id: "project-kysely",
	name: "api-kysely cleanup followup",
	slugId: "api-kysely-cleanup-followup-8c1f2e4a7b9d",
	teams: { nodes: [{ id: "team-api", key: "API", name: "API" }] },
};

const platform = {
	id: "project-platform",
	name: "API platform",
	slugId: "api-platform-3e5a9c1d7f2b",
	teams: { nodes: [{ id: "team-plt", key: "PLT", name: "Platform" }] },
};

function parentOf(
	id: string,
	title: string,
	state: StateName,
	project: string | null,
) {
	return {
		identifier: id,
		title,
		url: `https://linear.app/acme/issue/${id}`,
		state: { type: stateOf(state).type },
		project: project === null ? null : { name: project },
	};
}

function ticket(
	id: string,
	title: string,
	state: StateName,
	parent: ReturnType<typeof parentOf> | null,
	milestone = "Cleanup",
): Record<string, unknown> {
	return {
		identifier: id,
		title,
		description: "",
		state: stateOf(state),
		updatedAt: "2026-10-21T12:00:00.000Z",
		history: { nodes: [] },
		parent,
		projectMilestone: { name: milestone },
		labels: { nodes: [] },
		assignee: null,
		attachments: { nodes: [] },
		comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
		inverseRelations: { nodes: [] },
	};
}

// Invented tickets, because a proof run must not read a live tracker. PLT-12
// sits in the tracked API platform project, DB-7 in the untracked Database
// guild project, and OPS-4 in no project.
const kyselyMove = parentOf(
	"PLT-12",
	"Move the API to Kysely",
	"In Progress",
	platform.name,
);
const builderRetire = parentOf(
	"DB-7",
	"Retire the legacy query builder",
	"In Progress",
	"Database guild",
);
const logCleanup = parentOf("OPS-4", "Clean up the query logs", "Done", null);

const followupIssues = [
	ticket("API-41", "Port the user queries", "In Progress", kyselyMove),
	ticket("API-42", "Port the order queries", "In Progress", kyselyMove),
	ticket("API-43", "Port the report queries", "Todo", kyselyMove),
	ticket("API-44", "Drop the Knex adapter", "Backlog", kyselyMove),
	ticket("API-45", "Remove the raw SQL helpers", "Todo", builderRetire),
	ticket("API-46", "Delete the builder tests", "Backlog", builderRetire),
	ticket("API-47", "Move the builder types", "In Progress", builderRetire),
	ticket("API-48", "Trim the slow query log", "Todo", logCleanup),
	ticket("API-49", "Rotate the query log files", "Backlog", logCleanup),
	ticket("API-50", "Write the Kysely runbook", "Todo", null),
];

const platformIssues = [
	ticket("PLT-12", "Move the API to Kysely", "In Progress", null),
	ticket("PLT-13", "Pin the Kysely version", "Done", null),
];

const followupFake = linearFake({
	project: followup,
	states: teamStates,
	issues: followupIssues,
});
const platformFake = linearFake({
	project: platform,
	states: teamStates,
	issues: platformIssues,
});

const platformMarks = [platform.id, platform.slugId, "team-plt", "PLT-"];

const fetch: Fetch = async (input, init) => {
	const body = typeof init?.body === "string" ? init.body : "";
	return platformMarks.some((mark) => body.includes(mark))
		? platformFake(input, init)
		: followupFake(input, init);
};

await serveRecorded({
	prefix: "project-flow-355-",
	port: process.argv[2]?.trim() || "4355",
	config: {
		pinned: [
			{ tracker: "linear", project: followup.slugId },
			{ tracker: "linear", project: platform.slugId },
		],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[followup.name]: {
				openView: "graph",
				groupBy: "workstream",
				graphDirection: "left-to-right",
			},
		},
	},
	fetch,
	now: () => new Date("2026-10-22T12:00:00.000Z"),
});
