import type { TicketRef } from "./ticket-key.ts";

const projectPrefix = "/projects/";
const ticketParams = ["ticket", "panelProject", "panelTracker"] as const;

/** The project that a project page path names. */
export function pathProject(pathname: string): string | null {
	return pathname.startsWith(projectPrefix)
		? decodeURIComponent(pathname.slice(projectPrefix.length))
		: null;
}

/** The page path with the open ticket in its query, or with none. */
export function ticketPath(path: string, ticket: TicketRef | null): string {
	const url = new URL(path, window.location.origin);
	for (const name of ticketParams) {
		url.searchParams.delete(name);
	}
	if (ticket !== null) {
		url.searchParams.set("ticket", ticket.key);
		if (ticket.project !== pathProject(url.pathname)) {
			url.searchParams.set("panelProject", ticket.project);
		}
		url.searchParams.set("panelTracker", ticket.tracker);
	}
	return `${url.pathname}${url.search}${url.hash}`;
}

/** The open ticket that a page URL names. A project page defaults to its own project. */
export function urlTicket(
	url: Pick<URL, "pathname" | "search">,
): TicketRef | null {
	const params = new URLSearchParams(url.search);
	const key = params.get("ticket")?.trim() ?? "";
	const project =
		params.get("panelProject")?.trim() || pathProject(url.pathname) || "";
	if (key === "" || project === "") {
		return null;
	}
	const tracker = params.get("panelTracker") === "linear" ? "linear" : "github";
	return { tracker, project, key };
}

export function projectPath(name: string, ticket?: TicketRef): string {
	const path = `${projectPrefix}${encodeURIComponent(name)}`;
	return ticket === undefined ? path : ticketPath(path, ticket);
}

export function openProject(name: string, ticket?: TicketRef): void {
	window.history.pushState(null, "", projectPath(name, ticket));
	window.scrollTo(0, 0);
	window.dispatchEvent(new PopStateEvent("popstate"));
}
