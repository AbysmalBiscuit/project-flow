import type { ProjectReport } from "./domain.ts";
import { sameTicketKey } from "./ticket-key.ts";

/**
 * Opens the PR of an unlinked PR card in a new tab, since it has no ticket for
 * the side panel. Two hosts can give one key, so the URL of the card picks the
 * PR. A card with a merge action stays for the side panel, which holds that
 * action, when the panel resolves its key to this card.
 */
export function openUnlinkedPr(
	report: ProjectReport,
	key: string,
	pullUrl: string | undefined,
): boolean {
	const unlinked = report.tickets.find(
		(item) =>
			item.unlinkedPr &&
			item.key === key &&
			(pullUrl === undefined || item.pullUrl === pullUrl),
	);
	if (unlinked?.pullUrl === undefined) {
		return false;
	}
	const panelCard = report.tickets.find(
		(item) => item.key !== null && sameTicketKey(item.key, key),
	);
	if (
		panelCard === unlinked &&
		unlinked.awaitingPulls?.some((pull) => pull.actions.includes("merge"))
	) {
		return false;
	}
	window.open(unlinked.pullUrl, "_blank", "noopener");
	return true;
}
