import type { CrossProjectBlocker } from "./domain.ts";

export function projectPath(
	name: string,
	ticket?: string,
	panelProject?: string,
	panelTracker?: CrossProjectBlocker["tracker"],
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
	panelTracker?: CrossProjectBlocker["tracker"],
): void {
	const next = projectPath(name, ticket, panelProject, panelTracker);
	window.history.pushState(null, "", next);
	window.dispatchEvent(new PopStateEvent("popstate"));
}
