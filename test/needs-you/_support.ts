export const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

export const linearProject = {
	id: "project-flow",
	name: "Project Flow",
	slugId: "project-flow",
};

export function linearIssue(
	identifier: string,
	title: string,
	description: string,
	comments: { body: string; user?: { id: string; name: string } }[] = [],
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title,
		description,
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		labels: { nodes: [] },
		comments: { nodes: comments },
		assignee: null,
		...fields,
	};
}
