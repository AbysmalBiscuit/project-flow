import type { ProjectCounts, ProjectReport } from "./domain.ts";
import { foldKey, type TicketSearchHit } from "./ticket-key.ts";

/** The tickets whose key or title holds the query, sorted by project, then by key. */
export function searchTickets(
	views: {
		counts: Pick<ProjectCounts, "name" | "tracker" | "tickets">;
		report: Pick<ProjectReport, "tickets" | "doneTickets">;
	}[],
	query: string,
): TicketSearchHit[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") {
		return [];
	}
	const hits: TicketSearchHit[] = [];
	for (const view of views) {
		const shown = [...view.report.tickets, ...view.report.doneTickets];
		for (const ticket of view.counts.tickets) {
			if (ticket.key === null) {
				continue;
			}
			const key = foldKey(ticket.key);
			const title = ticket.title.toLowerCase();
			if (!key.includes(needle) && !title.includes(needle)) {
				continue;
			}
			const url = shown.find(
				(item) => item.key !== null && foldKey(item.key) === key,
			)?.url;
			hits.push({
				project: view.counts.name,
				tracker: view.counts.tracker,
				key: ticket.key,
				...(url === undefined ? {} : { url }),
				title: ticket.title,
				state: ticket.state,
			});
		}
	}
	hits.sort((left, right) => {
		const byProject = left.project.localeCompare(right.project);
		return byProject !== 0 ? byProject : left.key.localeCompare(right.key);
	});
	return hits;
}
