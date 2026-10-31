import type {
	AwaitingPull,
	Lane,
	LiveRun,
	NeedsYouItem,
	OutsideParent,
	ProjectBody,
	ProjectReport,
	PullRequest,
	ReportSection,
	Ticket,
	TicketView,
} from "./domain.ts";
import { placeTickets } from "./grouping.ts";
import {
	type KnownTicketUrl,
	shownGraph,
	type ticketRelations,
} from "./links.ts";
import { settingsKey } from "./project-ref.ts";
import { graphParentsOf } from "./report-filter.ts";
import { foldKey, pullKey } from "./ticket-key.ts";

function summaryLine(counts: ProjectBody): string {
	return `${counts.name}: ${counts.done} done, ${counts.dropped} dropped, ${counts.blocked} blocked, ${counts.inProgress} in progress, ${counts.backlog} backlog.`;
}

/** The name of the forge that holds the PR at `url`. */
export type ForgeLabelOf = (url: string) => string | undefined;

export function projectReport(
	counts: ProjectBody,
	tickets: Ticket[],
	lanes: Lane[],
	statuses: Lane[],
	relationsByKey: Map<string, ReturnType<typeof ticketRelations>> = new Map(),
	pullByKey: Map<string, PullRequest> = new Map(),
	awaitingByKey: Map<string, AwaitingPull[]> = new Map(),
	needs: NeedsYouItem[] = [],
	runByKey: Map<string, LiveRun> = new Map(),
	outsideParents: OutsideParent[] = [],
	unlinkedPrs: TicketView[] = [],
	knownUrl: KnownTicketUrl = () => undefined,
	forgeLabelOf: ForgeLabelOf = () => undefined,
): ProjectReport {
	const forgeOfPull = (url: string | undefined) => {
		const pullForge = url === undefined ? undefined : forgeLabelOf(url);
		return pullForge === undefined ? {} : { pullForge };
	};
	const shownNeeds = needs.map((item) => {
		const forge =
			item.pull === undefined ? undefined : forgeLabelOf(item.pull.url);
		return item.pull === undefined || forge === undefined
			? item
			: { ...item, pull: { ...item.pull, forge } };
	});
	const placed = placeTickets(
		tickets,
		counts.tickets,
		counts.tracker,
		outsideParents,
	);
	const ticketsByKey = new Map(
		tickets.flatMap((ticket) =>
			ticket.key === null ? [] : [[ticket.key, ticket]],
		),
	);
	const inFlight = [
		...counts.tickets.filter((ticket) => {
			if (
				ticket.state === "inProgress" ||
				ticket.state === "inReview" ||
				ticket.state === "awaitingMerge"
			) {
				return true;
			}
			const source =
				ticket.key === null ? undefined : ticketsByKey.get(ticket.key);
			return (
				source?.state === "open" &&
				(ticket.state === "done" || ticket.state === "dropped")
			);
		}),
		...unlinkedPrs.map((pull) => ({
			key: pull.key,
			title: pull.title,
			state: pull.state,
			blockers: [],
		})),
	];
	const backlog = counts.tickets.filter((ticket) => ticket.state === "backlog");
	const sections: ReportSection[] = [
		{ id: "summary", title: "Summary", text: summaryLine(counts) },
		{ id: "inFlight", title: "In flight", items: inFlight },
		{
			id: "needsYou",
			title: "Needs you",
			needsYou: shownNeeds,
		},
		{ id: "backlog", title: "Backlog", items: backlog },
	];
	const needsKeys = new Set(
		needs.map((item) => foldKey(settingsKey(item.key, item.host))),
	);
	const placedByKey = new Map(
		placed.flatMap((item) =>
			item.ticket.key === null
				? []
				: [[foldKey(item.ticket.key), item] as const],
		),
	);
	const ticketViews = counts.tickets.map((view) => {
		const relations =
			view.key === null ? undefined : relationsByKey.get(foldKey(view.key));
		const pull =
			view.key === null ? undefined : pullByKey.get(foldKey(view.key));
		const awaitingPulls =
			view.key === null ? undefined : awaitingByKey.get(foldKey(view.key));
		const commentRun =
			view.key === null ? undefined : runByKey.get(foldKey(view.key));
		const placedItem =
			view.key === null ? undefined : placedByKey.get(foldKey(view.key));
		const source = view.key === null ? undefined : ticketsByKey.get(view.key);
		return {
			...view,
			...(source?.url === undefined ? {} : { url: source.url }),
			...(placedItem === undefined
				? {}
				: {
						workstream: placedItem.workstream,
						workstreamKey: placedItem.workstreamKey,
						theme: placedItem.theme,
						themeGroup: placedItem.themeGroup,
					}),
			...(commentRun === undefined ? {} : { run: commentRun }),
			...(relations === undefined
				? {}
				: { blockers: relations.blockers, blockedBy: relations.blockedBy }),
			...(relations === undefined || relations.links.length === 0
				? {}
				: { links: relations.links }),
			...(relations === undefined || relations.outsideBlockers.length === 0
				? {}
				: { outsideBlockers: relations.outsideBlockers }),
			...(relations === undefined || relations.blocks.length === 0
				? {}
				: { blocks: relations.blocks }),
			...(pull === undefined
				? {}
				: { pull: pullKey(pull), pullUrl: pull.url, ...forgeOfPull(pull.url) }),
			...(awaitingPulls === undefined ? {} : { awaitingPulls }),
			...(view.key !== null && needsKeys.has(foldKey(view.key))
				? { needsYou: true as const }
				: {}),
		};
	});
	const boardTickets = [
		...ticketViews,
		...unlinkedPrs.map((view) => ({
			...view,
			...(view.pullUrl === undefined ? {} : { url: view.pullUrl }),
			...forgeOfPull(view.pullUrl),
			...(view.key !== null &&
			needsKeys.has(foldKey(settingsKey(view.key, view.host)))
				? { needsYou: true as const }
				: {}),
		})),
	];
	const doneTickets = boardTickets.filter(
		(ticket) => ticket.statusType === "done",
	);
	const graph = shownGraph(
		counts.name,
		counts.tracker,
		boardTickets,
		relationsByKey,
		knownUrl,
	);
	return {
		name: counts.name,
		tracker: counts.tracker,
		lanes,
		statuses,
		tickets: boardTickets,
		sections,
		done: counts.done,
		total: counts.tickets.length,
		doneTickets,
		graphTickets: graph.tickets,
		graphLinks: graph.links,
		graphParents: graphParentsOf(graph.tickets, boardTickets),
		outsideParents,
	};
}
