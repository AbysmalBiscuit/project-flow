/**
 * Serves one recorded Linear project whose cards carry each server chip.
 * WID-1 shows the stale status and "Blocked" chips, WID-2 the "Run failed" chip and WID-3 the "Blocked" chip.
 * Usage: bun proof/serve-388.ts [PORT] [VIEW]
 */
import teamStates from "../test/fixtures/linear-team-states.json";
import { linearFake } from "../test/support.ts";
import { serveRecorded } from "./recorded.ts";

const slug = "widget-launch";
const [todo, inProgress] = ["Todo", "In Progress"].map((name) => {
	const state = teamStates.data.team.states.nodes.find(
		(item) => item.name === name,
	);
	if (state === undefined) {
		throw new Error(`recorded state ${name} is missing`);
	}
	return state;
});

function issue(
	identifier: string,
	title: string,
	state: typeof todo,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		identifier,
		title,
		description: "",
		updatedAt: "2026-10-22T12:00:00.000Z",
		state,
		parent: null,
		projectMilestone: null,
		labels: { nodes: [] },
		...fields,
	};
}

function progressComment(stage: string, at: string): Record<string, unknown> {
	return {
		comments: {
			nodes: [
				{
					id: `progress-${stage}`,
					body: `**Workcell progress**\n\n- ${stage}`,
					createdAt: at,
					updatedAt: at,
				},
			],
			pageInfo: { hasNextPage: false, endCursor: null },
		},
	};
}

const blockedByGate = {
	inverseRelations: {
		nodes: [
			{
				type: "blocks",
				issue: {
					identifier: "WID-4",
					title: "Open the gate",
					state: { type: "started" },
					project: { slugId: slug },
				},
			},
		],
	},
};

const view = process.argv[3]?.trim() || "board";

await serveRecorded({
	prefix: "project-flow-388-",
	port: process.argv[2]?.trim() || "4388",
	config: {
		pinned: [{ tracker: "linear", project: slug }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: { [slug]: { openView: view } },
	},
	fetch: linearFake({
		project: {
			id: "project-widget",
			name: "Widget launch",
			slugId: slug,
			teams: { nodes: [{ id: "team-widget", key: "WID", name: "Widget" }] },
		},
		states: teamStates.data.team.states.nodes,
		issues: [
			issue("WID-1", "Ship the list", todo, {
				...progressComment("stage 1: implementing", "2026-10-22T13:50:00.000Z"),
				...blockedByGate,
			}),
			issue(
				"WID-2",
				"Retry the import",
				todo,
				progressComment("stage 4: opening the PR", "2026-10-22T10:00:00.000Z"),
			),
			issue("WID-3", "Hold the launch", inProgress, blockedByGate),
			issue("WID-4", "Open the gate", inProgress),
		],
	}),
	now: () => new Date("2026-10-22T14:00:00.000Z"),
});
