export function projectPath(
	name: string,
	ticket?: string,
	panelProject?: string,
): string {
	const path = `/projects/${encodeURIComponent(name)}`;
	const params = new URLSearchParams();
	if (ticket !== undefined) {
		params.set("ticket", ticket);
	}
	if (panelProject !== undefined && panelProject !== name) {
		params.set("panelProject", panelProject);
	}
	const query = params.toString();
	return query === "" ? path : `${path}?${query}`;
}

export function openProject(
	name: string,
	ticket?: string,
	panelProject?: string,
): void {
	window.location.assign(projectPath(name, ticket, panelProject));
}
