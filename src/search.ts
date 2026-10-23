import type { ProjectCounts } from "./domain.ts";
import { foldKey, type TicketSearchHit } from "./ticket-key.ts";

/** The tickets whose key or title holds the query, sorted by project, then by key. */
export function searchTickets(
	views: {
		counts: Pick<ProjectCounts, "name" | "tracker" | "tickets">;
	}[],
	query: string,
): TicketSearchHit[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") {
		return [];
	}
	const hits: TicketSearchHit[] = [];
	for (const view of views) {
		for (const ticket of view.counts.tickets) {
			if (ticket.key === null) {
				continue;
			}
			const key = foldKey(ticket.key);
			const title = ticket.title.toLowerCase();
			if (!key.includes(needle) && !title.includes(needle)) {
				continue;
			}
			hits.push({
				project: view.counts.name,
				tracker: view.counts.tracker,
				key: ticket.key,
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
