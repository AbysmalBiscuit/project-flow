export function projectPath(
	name: string,
	ticket?: string,
	panelProject?: string,
	panelTracker?: "github" | "linear",
): string {
	const path = `/projects/${encodeURIComponent(name)}`;
	const params = new URLSearchParams();
	if (ticket !== undefined) {
		params.set("ticket", ticket);
	}
	if (panelProject !== undefined && panelProject !== name) {
		params.set("panelProject", panelProject);
	}
	if (panelTracker !== undefined) {
		params.set("panelTracker", panelTracker);
	}
	const query = params.toString();
	return query === "" ? path : `${path}?${query}`;
}

export function openProject(
	name: string,
	ticket?: string,
	panelProject?: string,
	panelTracker?: "github" | "linear",
): void {
	window.location.assign(projectPath(name, ticket, panelProject, panelTracker));
}
