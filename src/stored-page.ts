export function storeHoldsRead(body: {
	projects?: { pending?: boolean }[] | undefined;
	tracked?: boolean | undefined;
}): boolean {
	const projects = body.projects ?? [];
	return (
		projects.some((project) => project.pending !== true) ||
		body.tracked === false
	);
}

export const storedPageId = "project-flow-stored";

export const pollingPageId = "project-flow-polling";
