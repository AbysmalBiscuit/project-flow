export const repo = "acme/widget";
export const projectId = "PVT_widget";
export const projectTitle = "Widget board";
export const end = { hasNextPage: false, endCursor: null };
export const ask = "<!-- workcell:ask card-lanes -->\nWhich colour stays?";
export const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const older = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const codex = "chatgpt-codex-connector[bot]";

export const labels = [
	{ name: "ready", color: "d0d7de" },
	{ name: "factory: running", color: "f0c674" },
	{ name: "factory: in-review", color: "9ecbff" },
];

function recordedIssue(
	number: number,
	title: string,
	issueLabels: string[],
	state: "OPEN" | "CLOSED" = "OPEN",
	fields: Record<string, unknown> = {},
) {
	return {
		number,
		title,
		state,
		stateReason: state === "CLOSED" ? "COMPLETED" : null,
		updatedAt: "2026-10-18T12:00:00Z",
		createdAt: "2026-10-01T00:00:00Z",
		closedAt: state === "CLOSED" ? "2026-10-18T12:00:00Z" : null,
		body: "",
		comments: { nodes: [], pageInfo: end },
		labels: {
			nodes: issueLabels.map((name) => ({ name, color: "d0d7de" })),
			pageInfo: end,
		},
		assignees: { nodes: [] },
		milestone: null,
		parent: null,
		blockedBy: { nodes: [], pageInfo: end },
		blocking: { nodes: [], pageInfo: end },
		...fields,
	};
}

const blocker = recordedIssue(2, "Open the gate", ["ready"]);
const blocked = recordedIssue(3, "Hold the launch window", [], "OPEN", {
	blockedBy: {
		nodes: [
			{
				number: 2,
				title: "Open the gate",
				state: "OPEN",
				repository: { nameWithOwner: repo },
			},
		],
		pageInfo: end,
	},
});
const needs = recordedIssue(4, "Pick the card colour", ["ready"], "OPEN", {
	comments: {
		nodes: [
			{
				databaseId: 4,
				body: ask,
				createdAt: "2026-10-18T11:00:00Z",
				author: { login: "factory" },
			},
		],
		pageInfo: end,
	},
});
const dropped = recordedIssue(7, "Drop the unused card", [], "CLOSED", {
	stateReason: "NOT_PLANNED",
});
const mergeTicket = recordedIssue(8, "Wait for the merge", ["ready"]);

export const issues = [
	recordedIssue(9, "Park the board card", []),
	recordedIssue(1, "Queue the board card", ["ready"]),
	blocker,
	blocked,
	needs,
	recordedIssue(5, "Build the lane tint", ["factory: running"]),
	recordedIssue(6, "Read the review comments", ["factory: in-review"]),
	dropped,
	mergeTicket,
	...Array.from({ length: 6 }, (_, index) =>
		recordedIssue(10 + index, `Close item ${String(index + 1)}`, [], "CLOSED"),
	),
];

function projectStatus(
	name: string,
	optionId: string,
	color: string,
): Record<string, unknown> {
	return { name, optionId, color, updatedAt: "2026-10-18T12:00:00Z" };
}

function projectIssue(
	number: number,
	title: string,
	status: Record<string, unknown> | null,
	state: "OPEN" | "CLOSED" = "OPEN",
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		fieldValueByName: status,
		content: {
			__typename: "Issue",
			id: `I_${number}`,
			number,
			title,
			state,
			stateReason: state === "CLOSED" ? "COMPLETED" : null,
			updatedAt: "2026-10-18T12:00:00Z",
			body: "",
			comments: { totalCount: 0 },
			repository: { nameWithOwner: repo },
			milestone: null,
			labels: { nodes: [] },
			parent: null,
			closedByPullRequestsReferences: { nodes: [], pageInfo: end },
			blockedBy: { nodes: [], pageInfo: end },
			...fields,
		},
	};
}

export const statusOptions = [
	{ id: "opt-backlog", name: "Backlog", color: "GRAY" },
	{ id: "opt-ready", name: "Ready", color: "BLUE" },
	{ id: "opt-progress", name: "In progress", color: "YELLOW" },
	{ id: "opt-review", name: "In review", color: "ORANGE" },
	{ id: "opt-merge", name: "Awaiting merge", color: "GREEN" },
	{ id: "opt-done", name: "Done", color: "PURPLE" },
	{ id: "opt-dropped", name: "Dropped", color: "PINK" },
];

export const projectItems = [
	projectIssue(
		9,
		"Park the board card",
		projectStatus("Backlog", "opt-backlog", "GRAY"),
	),
	projectIssue(
		1,
		"Queue the board card",
		projectStatus("Ready", "opt-ready", "BLUE"),
	),
	projectIssue(2, "Open the gate", projectStatus("Ready", "opt-ready", "BLUE")),
	projectIssue(
		3,
		"Hold the launch window",
		projectStatus("Backlog", "opt-backlog", "GRAY"),
		"OPEN",
		{
			blockedBy: {
				nodes: [
					{
						number: 2,
						title: "Open the gate",
						state: "OPEN",
						repository: { nameWithOwner: repo },
					},
				],
				pageInfo: end,
			},
		},
	),
	projectIssue(
		4,
		"Pick the card colour",
		projectStatus("Ready", "opt-ready", "BLUE"),
		"OPEN",
		{
			comments: { totalCount: 1 },
			closedByPullRequestsReferences: {
				nodes: [{ number: 40, repository: { nameWithOwner: repo } }],
				pageInfo: end,
			},
		},
	),
	projectIssue(
		5,
		"Build the lane tint",
		projectStatus("In progress", "opt-progress", "YELLOW"),
	),
	projectIssue(
		6,
		"Read the review comments",
		projectStatus("In review", "opt-review", "ORANGE"),
	),
	projectIssue(
		8,
		"Wait for the merge",
		projectStatus("Awaiting merge", "opt-merge", "GREEN"),
		"OPEN",
		{
			closedByPullRequestsReferences: {
				nodes: [{ number: 70, repository: { nameWithOwner: repo } }],
				pageInfo: end,
			},
		},
	),
	...Array.from({ length: 6 }, (_, index) =>
		projectIssue(
			10 + index,
			`Close item ${String(index + 1)}`,
			projectStatus("Done", "opt-done", "PURPLE"),
			"CLOSED",
		),
	),
	projectIssue(
		7,
		"Drop the unused card",
		projectStatus("Dropped", "opt-dropped", "PINK"),
		"CLOSED",
		{
			stateReason: "NOT_PLANNED",
		},
	),
];
