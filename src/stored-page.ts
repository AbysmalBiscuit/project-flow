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

export const stateColoursPageId = "project-flow-state-colours";

export function readStoredPolling(): boolean | undefined {
	const node = document.getElementById(pollingPageId);
	if (node === null) {
		return undefined;
	}
	return node.textContent === "true";
}

function readJsonNode(id: string): unknown {
	const node = document.getElementById(id);
	if (node === null || node.textContent === null || node.textContent === "") {
		return undefined;
	}
	return JSON.parse(node.textContent) as unknown;
}

export function storedObject(body: unknown): Record<string, unknown> | null {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return null;
	}
	return body as Record<string, unknown>;
}

export function readStoredPage(): unknown {
	return readJsonNode(storedPageId);
}

export function readStoredStateColours(): unknown {
	return readJsonNode(stateColoursPageId);
}
