import { z } from "zod";
import {
	type Ask,
	askAnswer,
	askId,
	namesLev,
	progressAnswers,
	progressHeading,
	readAsks,
} from "./ask.ts";
import type {
	AutoMerge,
	Configuration,
	ProjectPin,
	ProjectViewSettings,
} from "./configuration.ts";
import type { KnownBot } from "./known-bots.ts";
import { knownBots } from "./known-bots.ts";
import {
	listedRef,
	ownerRepo,
	type ProjectRef,
	projectId,
	refRepo,
	repoKey,
	sameProject,
} from "./project-ref.ts";
import type { HidingFilter } from "./terms.ts";
import {
	blockerClearedId,
	commentNotificationId,
	foldKey,
	githubKey,
	itemId,
	keyNumber,
	keyRepo,
	keyTracker,
	linearKey,
	linkId,
	needsYouNotificationId,
	needsYouSeenId,
	outsideKey,
	pullKey,
	sameTicketKey,
	scopedKey,
	shortKey,
	ticketId,
	ticketRefId,
} from "./ticket-key.ts";
import {
	type GroupBy,
	laneAgeCap,
	savedProjectView,
	visibleLaneNames,
} from "./view-settings.ts";

export type WorkcellRun = {
	key: string;
	status: "running" | "failed";
	repo?: string;
};

export type LiveRun = {
	status: "running" | "failed";
	stage?: string;
};

export function todoRows(listing: string): { project: string }[] {
	const projects: { project: string }[] = [];
	const seen = new Set<string>();
	for (const line of listing.split("\n")) {
		const heading = line.match(/^## (.+)$/)?.[1]?.trim() ?? "";
		const project = heading.split(".")[0]?.trim() ?? "";
		if (project === "" || seen.has(heading)) {
			continue;
		}
		seen.add(heading);
		projects.push({ project: heading });
	}
	return projects;
}

export type StatusType =
	| "backlog"
	| "inProgress"
	| "inReview"
	| "awaitingMerge"
	| "done"
	| "dropped";

export type StatusColours = Record<StatusType, string>;

export type TicketState = StatusType;

const laneFallback: Record<TicketState, string> = {
	done: "Done",
	dropped: "Dropped",
	backlog: "Backlog",
	inProgress: "In progress",
	inReview: "In review",
	awaitingMerge: "Awaiting merge",
};

export type TicketRef = {
	tracker: "github" | "linear";
	project: string;
	key: string;
	state?: "open" | "closed";
	title?: string;
	projectName?: string;
};

export type Comment = {
	id?: string;
	body: string;
	createdAt?: string;
	updatedAt?: string;
	author?: string;
	reactions?: number;
};

export type TicketStatus = {
	id: string;
	name: string;
	statusType: StatusType;
	colour: string;
};

export type Ticket = {
	id: string;
	tracker: "github" | "linear";
	key: string | null;
	title: string;
	state: "open" | "closed";
	stateReason: string | null;
	updatedAt: string;
	ref?: string;
	body: string;
	blockedBy: TicketRef[];
	blocks?: TicketRef[];
	comments?: Comment[];
	milestone: string | null;
	parent: string | null;
	/** What the tracker read says about the parent ticket. */
	parentDetails?: ParentDetails;
	labels: string[];
	assignee?: string | null;
	assignees?: string[];
	status?: TicketStatus;
	emptyStatus?: boolean;
	history?: { statusId: string; at: string; statusType?: StatusType }[];
	closedAt?: string;
	createdAt?: string;
};

export type ParentDetails = {
	title: string;
	/** The lane state, absent when the tracker read says only that it is open. */
	state?: TicketState;
	project: string;
	url: string;
};

export type TicketRelation = {
	tracker: "github" | "linear";
	project: string;
	key: string;
	title: string;
};

export type GraphLink = {
	key: string;
	done: boolean;
	outside?: TicketRelation;
};

export type GraphEnd = {
	project: string;
	key: string;
	tracker: "github" | "linear";
	title: string;
	state?: TicketState;
};

export type ShownGraphLink = {
	from: GraphEnd;
	to: GraphEnd;
	done: boolean;
};

export type TicketView = {
	key: string | null;
	title: string;
	state: TicketState;
	blockers: string[];
	/** Each open blocker, resolved to its project and title. */
	blockedBy?: TicketRelation[];
	links?: GraphLink[];
	outsideBlockers?: TicketRelation[];
	blocks?: TicketRelation[];
	lane?: string;
	statusType?: StatusType;
	blocked?: boolean;
	staleStatus?: string;
	chips?: string[];
	pull?: string;
	pullUrl?: string;
	needsYou?: boolean;
	enteredStateAt?: string;
	run?: LiveRun;
	updatedAt?: string;
	assignees?: string[];
	workstream?: string;
	workstreamKey?: string;
	theme?: string;
	themeGroup?: string;
	parent?: string;
	subTickets?: number;
	/** How many direct sub-tickets are done. */
	subTicketsDone?: number;
	/** True when the ticket has sub-tickets and every descendant is done or dropped. */
	startsCollapsed?: true;
};

export type CrossProjectBlocker = {
	project: string;
	tracker: "github" | "linear";
	key: string;
	title: string;
};

/** A parent ticket that the project's tickets do not include. */
export type OutsideParent = CrossProjectBlocker & {
	state?: TicketState;
	url: string;
	/** The parent ticket's project is a tracked project. */
	tracked: boolean;
};

export type PullRequest = {
	repo: string;
	number: number;
	url: string;
	title: string;
	draft: boolean;
	branch: string;
	body: string;
	closingKeys: string[];
	headSha: string;
	headCommittedAt: string | null;
	merged: boolean;
	autoMerge?: boolean;
	checks: BotCheck[];
	comments: BotComment[];
	reviews: BotReview[];
	reactions: BotReaction[];
};

export type BotCheck = {
	name: string;
	status: string;
	conclusion: string | null;
};

export type BotComment = {
	login: string;
	body: string;
	createdAt: string | null;
	reactions?: number;
};

export const reviewStateValue = z.enum([
	"APPROVED",
	"CHANGES_REQUESTED",
	"COMMENTED",
	"DISMISSED",
	"PENDING",
]);

export type BotReview = {
	login: string;
	commitId: string;
	state?: z.infer<typeof reviewStateValue>;
};

export type BotReaction = {
	login: string;
	content: string;
	createdAt: string | null;
};

export type UnlinkedPr = {
	number: number;
	title: string;
	url: string;
	repo: string;
};

export type ProjectCounts = {
	name: string;
	tracker: "github" | "linear";
	ref: Configuration["tracked"][number];
	done: number;
	dropped: number;
	blocked: number;
	backlog: number;
	inProgress: number;
	inReview: number;
	awaitingMerge: number;
	unlinkedPrs: UnlinkedPr[];
	tickets: TicketView[];
	crossProjectBlockers: CrossProjectBlocker[];
	needsYou: number;
	progress: number;
	fetchedAt: string | null;
	error: string | null;
	tags: string[];
	statusTypes: Record<StatusType, number>;
	/** The card waits for its first read. */
	pending?: true;
};

export type ProjectBody = Omit<ProjectCounts, "ref">;

export type ThreadComment = {
	id: string;
	body: string;
	html: string;
	author: string;
	createdAt: string;
	url: string;
	parentId: string | null;
	kind: "comment" | "review";
	children: ThreadComment[];
};

export type Thread = {
	tracker: "github" | "linear";
	project: string;
	key: string;
	title: string;
	url: string;
	comments: ThreadComment[];
};

export type FetchedThread = Omit<Thread, "comments"> & {
	comments: Omit<ThreadComment, "html">[];
};

export type ReplyRequest = {
	tracker: "github" | "linear";
	project: string;
	key: string;
	body: string;
	parentId?: string;
	kind?: "comment" | "review";
};

export type PostedReply = {
	id: string;
	body: string;
	url: string;
	createdAt: string;
};

export type AskOption = {
	number: number;
	label: string;
};

export type PullStatus = {
	number: number;
	title: string;
	url: string;
	ci: "passing" | "failing" | "pending" | "none";
	review: "approved" | "changes" | "completed" | "pending" | "none";
};

export type NeedsYouItem = {
	project: string;
	tracker: "github" | "linear";
	key: string;
	headline: string;
	reason: "ask" | "awaitingMerge" | "label" | "runFailed";
	tags: string[];
	answered: boolean;
	acknowledged: boolean;
	question?: string;
	options?: AskOption[];
	pull?: PullStatus;
};

export type NotificationTrigger = "needsYou" | "comment" | "blockerCleared";

export type Notification = {
	id: string;
	trigger: NotificationTrigger;
	project: string;
	key: string;
	text: string;
	at: string;
	read: boolean;
};

export type Attention = {
	needsYou: NeedsYouItem[];
	comments: Map<
		string,
		{
			stamp: string;
			replyStamp: string;
			authors: string[];
			project: string;
			key: string;
		}
	>;
	blockers: Map<
		string,
		{ project: string; tracker: string; key: string; title: string }
	>;
	closed: Set<string>;
	closedBlockers: Set<string>;
};

function newestComment(comments: Comment[] | undefined): {
	stamp: string;
	authors: string[];
} {
	let newest = "";
	let authors: string[] = [];
	for (const comment of comments ?? []) {
		if (comment.body.trim() === "") {
			continue;
		}
		const createdAt = comment.createdAt ?? "";
		if (createdAt > newest) {
			newest = createdAt;
			authors = [comment.author].flatMap((author) =>
				author === undefined || author.trim() === "" ? [] : [author],
			);
		}
	}
	return { stamp: newest, authors };
}

function commentSources(
	item: NeedsYouItem,
	tickets: Map<string, Ticket>,
	pulls: PullRequest[],
): Comment[] {
	const ticket = tickets.get(ticketId(item.tracker, item.key));
	if (ticket !== undefined) {
		const linkedPulls = linked(ticket, pulls);
		return [...(ticket.comments ?? []), ...linkedPulls.flatMap(pullComments)];
	}
	const pull = pulls.find((candidate) =>
		sameTicketKey(pullKey(candidate), item.key),
	);
	return pull === undefined ? [] : pullComments(pull);
}

export function attentionOf(
	views: {
		items: NeedsYouItem[];
		counts: ProjectCounts;
		row: Snapshot;
	}[],
	pmBot: Record<string, boolean> = {},
): Attention {
	const comments: Attention["comments"] = new Map();
	const blockers: Attention["blockers"] = new Map();
	const closed = new Set<string>();
	const closedBlockers = new Set<string>();
	const tickets = new Map<string, Ticket>();
	for (const view of views) {
		for (const ticket of view.row.tickets) {
			if (ticket.key === null) {
				continue;
			}
			const id = ticketId(ticket.tracker, ticket.key);
			tickets.set(id, ticket);
			if (ticket.state === "closed") {
				closed.add(id);
			}
		}
	}
	for (const view of views) {
		const pulls = view.row.pulls.filter((pull) => !pull.merged);
		for (const item of view.items) {
			const itemComments = commentSources(item, tickets, pulls);
			const ask = openAsk(
				itemComments,
				projectHasPmBot(pmBot, view.row.key, view.row.tracker),
			);
			const reply =
				item.reason === "ask" && ask !== null
					? (ask.answer?.comment ?? null)
					: null;
			const newest = newestComment(itemComments);
			comments.set(itemId(item.project, item.key), {
				stamp: newest.stamp,
				replyStamp: reply?.createdAt ?? "",
				authors: newest.authors,
				project: item.project,
				key: item.key,
			});
		}
		for (const blocker of view.counts.crossProjectBlockers) {
			const crossBlocker = {
				project: view.counts.name,
				tracker: blocker.tracker,
				key: blocker.key,
				title: blocker.title.trim() === "" ? blocker.key : blocker.title,
			};
			blockers.set(ticketRefId(crossBlocker), crossBlocker);
		}
		for (const ticket of view.row.tickets) {
			if (ticket.key === null) {
				continue;
			}
			for (const ref of ticket.blockedBy) {
				const id = ticketId(ref.tracker, ref.key);
				if (tickets.has(id) || ref.state !== "closed") {
					continue;
				}
				closedBlockers.add(id);
			}
		}
	}
	return {
		needsYou: views.flatMap((view) => view.items),
		comments,
		blockers,
		closed,
		closedBlockers,
	};
}

export function attentionIds(attention: Attention): string[] {
	return [
		...attention.needsYou.map(needsYouSeenId),
		...[...attention.comments.values()].map((comment) =>
			commentNotificationId(comment, comment.stamp),
		),
	];
}

export function departedNeedsYouIds(
	before: Attention,
	after: Attention,
	loadedProjects: ReadonlySet<string>,
): string[] {
	const current = new Set(
		after.needsYou.map((item) => itemId(item.project, item.key)),
	);
	return before.needsYou.flatMap((item) =>
		!loadedProjects.has(item.project) ||
		current.has(itemId(item.project, item.key))
			? []
			: [needsYouSeenId(item)],
	);
}

export function notificationsFor(
	before: Attention,
	after: Attention,
	triggers: Configuration["notificationTriggers"],
	at: string,
	seen: ReadonlySet<string>,
	viewers: readonly string[] = [],
): Notification[] {
	const viewerAuthors = new Set(
		viewers.map((viewer) => viewer.trim().toLowerCase()).filter(Boolean),
	);
	const found: Notification[] = [];
	const push = (
		trigger: NotificationTrigger,
		key: string,
		project: string,
		itemKey: string,
		text: string,
	) => {
		if (seen.has(key)) {
			return;
		}
		found.push({
			id: key,
			trigger,
			project,
			key: itemKey,
			text,
			at,
			read: false,
		});
	};
	if (triggers.needsYou) {
		const previous = new Set(
			before.needsYou.map((item) => itemId(item.project, item.key)),
		);
		for (const item of after.needsYou) {
			const id = itemId(item.project, item.key);
			if (previous.has(id)) {
				continue;
			}
			const seenId = needsYouSeenId(item);
			if (seen.has(seenId)) {
				continue;
			}
			push(
				"needsYou",
				needsYouNotificationId(item, at),
				item.project,
				item.key,
				item.headline,
			);
		}
	}
	if (triggers.comment) {
		for (const [id, comment] of after.comments) {
			const earlier = before.comments.get(id)?.stamp;
			if (
				earlier === undefined ||
				comment.stamp === "" ||
				comment.stamp <= earlier
			) {
				continue;
			}
			if (comment.replyStamp !== "" && comment.stamp === comment.replyStamp) {
				continue;
			}
			if (
				comment.authors.some((author) =>
					viewerAuthors.has(author.toLowerCase()),
				)
			) {
				continue;
			}
			const item = after.needsYou.find(
				(candidate) => itemId(candidate.project, candidate.key) === id,
			);
			push(
				"comment",
				commentNotificationId(comment, comment.stamp),
				comment.project,
				comment.key,
				item?.headline ?? comment.key,
			);
		}
	}
	if (triggers.blockerCleared) {
		for (const [id, blocker] of before.blockers) {
			if (after.blockers.has(id)) {
				continue;
			}
			const closedKey = ticketId(blocker.tracker, blocker.key);
			if (
				!after.closed.has(closedKey) &&
				!after.closedBlockers.has(closedKey)
			) {
				continue;
			}
			push(
				"blockerCleared",
				blockerClearedId(blocker, at),
				blocker.project,
				blocker.key,
				blocker.title,
			);
		}
	}
	return found;
}

export type InboxDay = "today" | "yesterday" | "earlier";

export type InboxEntry = Notification & {
	day: InboxDay;
	tracker: "github" | "linear";
};

function calendarDay(stamp: Date): number {
	return Date.UTC(stamp.getFullYear(), stamp.getMonth(), stamp.getDate());
}

export function inboxEntries(entries: Notification[], now: Date): InboxEntry[] {
	const today = calendarDay(now);
	const yesterday = Date.UTC(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - 1,
	);
	return entries.map((entry) => {
		const stamp = new Date(entry.at);
		const day: InboxDay = Number.isNaN(stamp.getTime())
			? "earlier"
			: calendarDay(stamp) === today
				? "today"
				: calendarDay(stamp) === yesterday
					? "yesterday"
					: "earlier";
		return {
			...entry,
			day,
			tracker: keyTracker(entry.key),
		};
	});
}

export type ReportSection = {
	id: "summary" | "inFlight" | "needsYou" | "backlog";
	title: string;
	text?: string;
	items?: TicketView[];
	needsYou?: NeedsYouItem[];
};

export type Lane = {
	id: string;
	name: string;
	colour: string;
	statusType: StatusType;
	added?: boolean;
	evidence?: StatusType;
};

export type ProjectReport = {
	name: string;
	tracker: "github" | "linear";
	lanes: Lane[];
	tickets: TicketView[];
	sections: ReportSection[];
	done: number;
	total: number;
	doneTickets: TicketView[];
	graphTickets: TicketView[];
	graphLinks: ShownGraphLink[];
	/** The parent tickets of graph tickets that the graph does not show itself. Each heads the frame of its shown sub-tickets. */
	graphParents: TicketView[];
	outsideParents: OutsideParent[];
	/** Filters that leave no ticket on the board, graph or table. */
	hiddenBy?: HidingFilter[];
};

export function displayedLaneName(ticket: TicketView): string {
	return ticket.lane ?? laneFallback[ticket.state];
}

export function doneTicketsForLane(
	report: ProjectReport,
	lane: string,
): TicketView[] {
	return report.doneTickets.filter(
		(ticket) => displayedLaneName(ticket) === lane,
	);
}

export type Overview = {
	projects: ProjectCounts[];
	fetchedAt: string | null;
	error: string | null;
	polling?: true;
	tracked?: false;
};

/** Projects finished in the poll that is running, out of the tracked projects. */
export type PollProgress = {
	done: number;
	total: number;
	project: string | null;
	ended: boolean;
};

export type FetchStatus = {
	fetchedAt: string | null;
	error: string | null;
};

export type Board = {
	kind: "linear" | "github-project" | "github-repo";
	laneKey?: string;
	statuses: TicketStatus[];
	factoryLabels: boolean;
};

export type Snapshot = {
	key: string;
	name: string;
	tracker: "github" | "linear";
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
	board?: Board;
	owner?: string;
	number?: number;
	listedEmpty?: boolean;
};

export type ProjectPoll = {
	ref: ProjectRef;
	ok: boolean;
	error: string | null;
	full: boolean;
	row: Snapshot | null;
};

export function staleView(
	status: FetchStatus,
	goodPollAt: string | null,
): FetchStatus {
	if (status.error === null) {
		return { fetchedAt: status.fetchedAt, error: null };
	}
	if (goodPollAt === null) {
		return { fetchedAt: status.fetchedAt, error: status.error };
	}
	return {
		fetchedAt: goodPollAt,
		error: `${status.error} (stale since ${goodPollAt})`,
	};
}

const closing =
	/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)|#(\d+)|([A-Za-z][A-Za-z0-9]*)-(\d+))\b/gi;

function closingKeys(body: string, repo: string): string[] {
	const keys: string[] = [];
	for (const match of body.matchAll(closing)) {
		const namedRepo = match[1];
		const namedNumber = match[2];
		const bareNumber = match[3];
		const team = match[4];
		const linearNumber = match[5];
		const key =
			namedRepo !== undefined && namedNumber !== undefined
				? githubKey(namedRepo, namedNumber)
				: bareNumber !== undefined
					? githubKey(repo, bareNumber)
					: team !== undefined && linearNumber !== undefined
						? linearKey(team, linearNumber)
						: null;
		if (key !== null && !keys.includes(key)) {
			keys.push(key);
		}
	}
	return keys;
}

function sameRef(left: TicketRef, right: TicketRef): boolean {
	return left.tracker === right.tracker && sameTicketKey(left.key, right.key);
}

function mergeBlockedBy(rows: TicketRef[][]): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const row of rows) {
		for (const ref of row) {
			const earlier = refs.findIndex((item) => sameRef(item, ref));
			if (earlier === -1) {
				refs.push(ref);
				continue;
			}
			const kept = refs[earlier];
			if (kept === undefined) {
				continue;
			}
			if (ref.state === "open" && kept.state === "closed") {
				refs[earlier] = ref;
				continue;
			}
			if (ref.state === "closed" && kept.state !== "closed") {
				refs[earlier] = ref;
			}
		}
	}
	return refs;
}

export function heldBlockerIds(held: Ticket[]): number[] {
	return held.flatMap((ticket) => {
		if (
			ticket.state !== "open" ||
			ticket.key === null ||
			ticket.blockedBy.length === 0 ||
			!Number.isInteger(Number(ticket.id))
		) {
			return [];
		}
		return [Number(ticket.id)];
	});
}

export function refreshedBlockers(
	listed: Ticket[],
	held: Ticket[],
	refsById: Map<number, TicketRef[]>,
): Ticket[] {
	const fresh = held.flatMap((ticket) => {
		if (!Number.isInteger(Number(ticket.id))) {
			return [];
		}
		const blockedBy = refsById.get(Number(ticket.id));
		if (blockedBy === undefined) {
			return [];
		}
		const listedTicket = listed.find((item) => item.id === ticket.id);
		return [{ ...(listedTicket ?? ticket), blockedBy }];
	});
	const freshKeys = new Set(
		fresh.flatMap((ticket) => (ticket.key === null ? [] : [ticket.key])),
	);
	return [
		...listed.filter(
			(ticket) => ticket.key === null || !freshKeys.has(ticket.key),
		),
		...fresh,
	];
}

function ticketIdentity(ticket: Ticket): string {
	return ticket.key === null ? ticket.id : ticketId(ticket.tracker, ticket.key);
}

export function mergeTickets(stored: Ticket[], incoming: Ticket[]): Ticket[] {
	const byId = new Map(
		stored.map((ticket) => [ticketIdentity(ticket), ticket]),
	);
	for (const ticket of incoming) {
		byId.set(ticketIdentity(ticket), ticket);
	}
	return [...byId.values()];
}

export type PollReconcile = {
	rows: Snapshot[];
	projectErrors: { ref: ProjectRef; error: string }[];
	globalError: string | null;
};

function keptPulls(
	stored: PullRequest[],
	incoming: PullRequest[],
	returnedIds: Set<string>,
	full: boolean,
): PullRequest[] {
	if (full) {
		return incoming;
	}
	const incomingIds = new Set(incoming.map((pull) => foldKey(pullKey(pull))));
	const incomingKeys = new Set(
		incoming.flatMap((pull) => pull.closingKeys.map((key) => foldKey(key))),
	);
	return [
		...incoming,
		...stored.filter(
			(pull) =>
				!incomingIds.has(foldKey(pullKey(pull))) &&
				!pull.closingKeys.some(
					(key) =>
						returnedIds.has(foldKey(key)) || incomingKeys.has(foldKey(key)),
				),
		),
	];
}

export function reconcilePoll(
	previous: Snapshot[],
	outcomes: ProjectPoll[],
	fullPolled: boolean,
): PollReconcile {
	const rows: Snapshot[] = [];
	const projectErrors: PollReconcile["projectErrors"] = [];
	const seen = new Set<string>();
	const priorOf = (ref: ProjectRef) =>
		previous.find((row) => sameProject(listedRef(row), ref));
	for (const outcome of outcomes) {
		seen.add(projectId(outcome.ref));
		if (outcome.ok) {
			if (outcome.row === null) {
				continue;
			}
			const prior = priorOf(outcome.ref);
			const tickets = outcome.full
				? outcome.row.tickets
				: mergeTickets(prior?.tickets ?? [], outcome.row.tickets);
			const returnedIds = new Set(
				outcome.row.tickets.flatMap((ticket) =>
					ticket.key === null ? [] : [foldKey(ticket.key)],
				),
			);
			const listedEmpty = outcome.full
				? outcome.row.listedEmpty
				: (prior?.listedEmpty ?? outcome.row.listedEmpty);
			rows.push({
				...outcome.row,
				tickets,
				pulls: keptPulls(
					prior?.pulls ?? [],
					outcome.row.pulls,
					returnedIds,
					outcome.full,
				),
				...(listedEmpty === undefined ? {} : { listedEmpty }),
			});
			continue;
		}
		if (outcome.error !== null) {
			projectErrors.push({ ref: outcome.ref, error: outcome.error });
		}
		const prior = priorOf(outcome.ref);
		if (prior !== undefined) {
			rows.push(prior);
			continue;
		}
		if (outcome.row === null || outcome.error === null) {
			continue;
		}
		rows.push(outcome.row);
	}
	for (const row of previous) {
		if (seen.has(projectId(listedRef(row))) || fullPolled) {
			continue;
		}
		rows.push(row);
	}
	const failed = outcomes.find(
		(outcome) =>
			!outcome.ok &&
			outcome.error !== null &&
			!rows.some((row) => sameProject(listedRef(row), outcome.ref)),
	);
	const globalError = failed?.error ?? null;
	return { rows: claimTickets(rows), projectErrors, globalError };
}

const appLaneNames: Record<StatusType, string> = {
	backlog: "Backlog",
	inProgress: "In progress",
	inReview: "In review",
	awaitingMerge: "Awaiting merge",
	done: "Done",
	dropped: "Dropped",
};

const statusTypeOrder: StatusType[] = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
	"dropped",
];

const factoryLabels = [
	"ready",
	"factory: running",
	"factory: in-review",
] as const;

const reviewNames = new Set([
	"in review",
	"in-review",
	"review",
	"factory: in-review",
]);

const progressNames = new Set([
	"in progress",
	"in-progress",
	"doing",
	"started",
	"factory: running",
]);

const awaitingNames = new Set([
	"awaiting merge",
	"awaiting-merge",
	"ready to merge",
	"ready for merge",
]);

const doneNames = new Set(["done", "completed", "shipped", "merged"]);
const droppedNames = new Set([
	"dropped",
	"canceled",
	"cancelled",
	"duplicate",
	"won't do",
	"wont do",
]);

function laneName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function appLane(statusType: StatusType, colours: StatusColours): Lane {
	return {
		id: statusType,
		name: appLaneNames[statusType],
		colour: colours[statusType],
		statusType,
	};
}

export function appLanes(colours: StatusColours): Lane[] {
	return statusTypeOrder.map((statusType) => appLane(statusType, colours));
}

export function statusTypeOfName(name: string): StatusType {
	const lowered = laneName(name);
	if (reviewNames.has(lowered)) {
		return "inReview";
	}
	if (awaitingNames.has(lowered)) {
		return "awaitingMerge";
	}
	if (progressNames.has(lowered)) {
		return "inProgress";
	}
	if (doneNames.has(lowered)) {
		return "done";
	}
	if (droppedNames.has(lowered)) {
		return "dropped";
	}
	return "backlog";
}

export function linearStatusType(type: string, name: string): StatusType {
	if (type === "completed") {
		return "done";
	}
	if (type === "canceled" || type === "duplicate") {
		return "dropped";
	}
	if (type === "started") {
		const named = statusTypeOfName(name);
		if (named === "inReview" || named === "awaitingMerge") {
			return named;
		}
		return "inProgress";
	}
	return "backlog";
}

function namesMatch(left: string, right: string): boolean {
	return laneName(left) === laneName(right);
}

function mappedEvidence(
	mapping: LaneMapping,
	name: string,
): StatusType | undefined {
	for (const statusType of statusTypeOrder) {
		const mapped = mapping[statusType];
		if (mapped !== undefined && namesMatch(mapped, name)) {
			return statusType;
		}
	}
	return undefined;
}

function insertAwaitingMerge(lanes: Lane[], colours: StatusColours): Lane[] {
	if (
		lanes.some(
			(lane) =>
				lane.evidence === "awaitingMerge" ||
				awaitingNames.has(laneName(lane.name)),
		)
	) {
		return lanes;
	}
	const review = lanes.findLastIndex(
		(lane) =>
			lane.statusType === "inReview" || reviewNames.has(laneName(lane.name)),
	);
	const added: Lane = {
		id: "awaiting-merge",
		name: appLaneNames.awaitingMerge,
		colour: colours.awaitingMerge,
		statusType: "awaitingMerge",
		added: true,
	};
	const at = review === -1 ? laneInsertAt(lanes, "awaitingMerge") : review + 1;
	return [...lanes.slice(0, at), added, ...lanes.slice(at)];
}

type LaneMapping = Configuration["laneMappings"][string];

function trackerLanes(board: Board | undefined): boolean {
	if (board === undefined) {
		return false;
	}
	if (board.kind === "github-repo") {
		return board.factoryLabels;
	}
	return board.statuses.length > 0;
}

export function lanesFor(
	board: Board | undefined,
	mapping: LaneMapping,
	colours: StatusColours,
): Lane[] {
	if (!trackerLanes(board) || board === undefined) {
		return appLanes(colours);
	}
	const lanes = board.statuses.map((status) => {
		const evidence = mappedEvidence(mapping, status.name);
		const lane: Lane = {
			id: status.id,
			name: status.name,
			colour: status.colour,
			statusType: status.statusType,
		};
		if (evidence !== undefined) {
			lane.evidence = evidence;
		}
		return lane;
	});
	return insertAwaitingMerge(lanes, colours);
}

export function laneForTicket(
	ticket: Ticket,
	lanes: Lane[],
	colours: StatusColours,
): Lane {
	if (ticket.emptyStatus === true) {
		return laneOfType(lanes, closedLaneType(ticket) ?? "backlog", colours);
	}
	const matched =
		ticket.status === undefined ? undefined : laneOfStatus(ticket, lanes);
	const closedType = closedLaneType(ticket);
	if (closedType !== undefined) {
		if (matched?.statusType === closedType) {
			return matched;
		}
		return laneOfType(lanes, closedType, colours);
	}
	if (matched !== undefined) {
		return matched;
	}
	if (ticket.status === undefined) {
		return laneOfType(lanes, "backlog", colours);
	}
	return laneOfType(lanes, ticket.status.statusType, colours);
}

function laneOfType(
	lanes: Lane[],
	statusType: StatusType,
	colours: StatusColours,
): Lane {
	return (
		lanes.find((lane) => lane.statusType === statusType) ??
		appLane(statusType, colours)
	);
}

function placeOnBoard(
	lanes: Lane[],
	tickets: Ticket[],
	colours: StatusColours,
): Lane[] {
	const placed = [...lanes];
	for (const ticket of tickets) {
		const statusType = laneForTicket(ticket, placed, colours).statusType;
		if (placed.some((lane) => lane.statusType === statusType)) {
			continue;
		}
		placed.splice(laneInsertAt(placed, statusType), 0, {
			...appLane(statusType, colours),
			added: true,
		});
	}
	return placed;
}

function laneInsertAt(lanes: Lane[], statusType: StatusType): number {
	const order = statusTypeOrder.indexOf(statusType);
	const after = lanes.findLastIndex(
		(lane) => statusTypeOrder.indexOf(lane.statusType) < order,
	);
	return after + 1;
}

function closedLaneType(ticket: Ticket): StatusType | undefined {
	if (ticket.state !== "closed") {
		return undefined;
	}
	return closedStatusType(ticket.stateReason);
}

export function closedStatusType(stateReason: string | null): StatusType {
	return closedReasons.has(stateReason ?? "") ? "dropped" : "done";
}

function laneOfStatus(ticket: Ticket, lanes: Lane[]): Lane | undefined {
	const status = ticket.status;
	if (status === undefined) {
		return undefined;
	}
	return (
		lanes.find((lane) => lane.id === status.id) ??
		lanes.find((lane) => namesMatch(lane.name, status.name))
	);
}

function factoryLaneType(name: string): StatusType {
	if (name === "ready") {
		return "backlog";
	}
	if (name === "factory: running") {
		return "inProgress";
	}
	return "inReview";
}

export function factoryBoard(
	labels: { name: string; colour: string }[],
): Board {
	const present = factoryLabels.flatMap((name) => {
		const label = labels.find((item) => item.name === name);
		return label === undefined ? [] : [label];
	});
	return {
		kind: "github-repo",
		factoryLabels: present.length === factoryLabels.length,
		statuses: present.map((label) => ({
			id: label.name,
			name: label.name,
			colour: label.colour,
			statusType: factoryLaneType(label.name),
		})),
	};
}

export const emptyStatusTypes = (): Record<StatusType, number> => ({
	backlog: 0,
	inProgress: 0,
	inReview: 0,
	awaitingMerge: 0,
	done: 0,
	dropped: 0,
});

const closedReasons = new Set(["not_planned", "duplicate", "canceled"]);

const label =
	/^(?:[-*+]|\d+[.)])?\s*(?:\*\*|__)?\s*(blocked by|blocks|blocking)(?![\p{L}\p{N}])\s*(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*(.*)$/iu;

const anchoredRef =
	/^(?:https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)|https?:\/\/linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]+-\d+)(?:\/[^\s)]*)?|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)|#(\d+)|([A-Za-z][A-Za-z0-9]+-\d+))$/i;

function trimPunctuation(token: string): string {
	return token.replace(/^[([{"']+/, "").replace(/[)\]}"'.,;:!?]+$/, "");
}

function refFrom(
	match: RegExpExecArray,
	repo: string | null,
): TicketRef | null {
	const githubUrlOwner = match[1];
	const githubUrlRepo = match[2];
	const githubUrlNumber = match[3];
	if (
		githubUrlOwner !== undefined &&
		githubUrlRepo !== undefined &&
		githubUrlNumber !== undefined
	) {
		const repo = `${githubUrlOwner}/${githubUrlRepo}`;
		return {
			tracker: "github",
			project: repo,
			key: githubKey(repo, githubUrlNumber),
		};
	}
	const linearUrlKey = match[4];
	if (linearUrlKey !== undefined) {
		return { tracker: "linear", project: "", key: linearUrlKey.toUpperCase() };
	}
	const ownerRepo = match[5];
	const ownerNumber = match[6];
	if (ownerRepo !== undefined && ownerNumber !== undefined) {
		return {
			tracker: "github",
			project: ownerRepo,
			key: githubKey(ownerRepo, ownerNumber),
		};
	}
	const sameNumber = match[7];
	if (sameNumber !== undefined) {
		if (repo === null) {
			return null;
		}
		return {
			tracker: "github",
			project: repo,
			key: githubKey(repo, sameNumber),
		};
	}
	const linearMatch = match[8];
	if (linearMatch !== undefined) {
		return { tracker: "linear", project: "", key: linearMatch.toUpperCase() };
	}
	return null;
}

function parseLine(
	line: string,
	repo: string | null,
	direction: "blockedBy" | "blocks",
): TicketRef[] {
	const matched = line.trim().match(label);
	if (matched?.[1] === undefined || matched[2] === undefined) {
		return [];
	}
	const verb = matched[1].toLowerCase();
	if (
		(direction === "blockedBy" && verb !== "blocked by") ||
		(direction === "blocks" && verb === "blocked by")
	) {
		return [];
	}
	const refs: TicketRef[] = [];
	for (const raw of matched[2].split(",")) {
		const token = trimPunctuation(raw.trim());
		if (token === "" || token.toLowerCase() === "none") {
			continue;
		}
		const found = anchoredRef.exec(token);
		if (found === null) {
			continue;
		}
		const ref = refFrom(found, repo);
		if (ref !== null && !refs.some((item) => sameRef(item, ref))) {
			refs.push(ref);
		}
	}
	return refs;
}

export function bodyBlockers(
	ticket: Ticket,
	repo: string | null,
	direction: "blockedBy" | "blocks",
): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const line of ticket.body.split("\n")) {
		for (const ref of parseLine(line, repo, direction)) {
			if (!refs.some((item) => sameRef(item, ref))) {
				refs.push(ref);
			}
		}
	}
	return refs;
}

type TicketIndex = Map<string, Ticket>;

function indexTickets(tickets: Ticket[]): TicketIndex {
	const index = new Map<string, Ticket>();
	for (const ticket of tickets) {
		if (ticket.key === null) {
			continue;
		}
		const key = ticketId(ticket.tracker, ticket.key);
		const earlier = index.get(key);
		if (earlier === undefined) {
			index.set(key, ticket);
			continue;
		}
		index.set(key, {
			...earlier,
			body: earlier.body.trim() === "" ? ticket.body : earlier.body,
			blockedBy: mergeBlockedBy([earlier.blockedBy, ticket.blockedBy]),
			blocks: mergeBlockedBy([earlier.blocks ?? [], ticket.blocks ?? []]),
		});
	}
	return index;
}

function known(index: TicketIndex, ref: TicketRef): Ticket | undefined {
	return index.get(ticketId(ref.tracker, ref.key));
}

function stillOpen(ref: TicketRef, index: TicketIndex): boolean {
	const ticket = known(index, ref);
	if (ticket !== undefined && ticket.state === "open") {
		return true;
	}
	if (ref.state === "closed") {
		return false;
	}
	if (ticket !== undefined) {
		return ticket.state === "open";
	}
	return ref.state === "open";
}

function asRef(ticket: Ticket): TicketRef | null {
	if (ticket.key === null) {
		return null;
	}
	return { tracker: ticket.tracker, project: "", key: ticket.key };
}

function outsideTicket(ref: TicketRef): Ticket {
	return {
		id: ref.key,
		tracker: ref.tracker,
		key: ref.key,
		title: ref.title?.trim() || ref.key,
		state: "open",
		stateReason: null,
		updatedAt: "",
		body: "",
		blockedBy: [],
		milestone: null,
		parent: null,
		labels: [],
	};
}

type ParsedBodies = Map<
	string,
	{ blockedBy: TicketRef[]; blocks: TicketRef[] }
>;

function parseKey(ticket: Ticket): string {
	return ticketId(ticket.tracker, ticket.key ?? "");
}

function bodyLines(donor: Ticket | undefined, ticket: Ticket): string {
	if (donor === undefined || donor === ticket || ticket.body.trim() === "") {
		return "";
	}
	const lines = [];
	for (const line of donor.body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("Blocks:") || trimmed.startsWith("Blocking:")) {
			lines.push(trimmed);
		}
	}
	return lines.join("\n");
}

/** The repo that a bare `#number` in a ticket body names. */
function bodyRepo(ticket: Ticket, repo: string | null): string | null {
	if (repo !== null || ticket.tracker !== "github" || ticket.key === null) {
		return repo;
	}
	return keyRepo(ticket.key);
}

/** The tickets of one project, with its repo when the project is a GitHub repo. */
export type ProjectGroup = {
	project: string;
	repo: string | null;
	tickets: Ticket[];
};

function parseBodies(groups: ProjectGroup[]): ParsedBodies {
	const parsed: ParsedBodies = new Map();
	for (const group of groups) {
		for (const ticket of group.tickets) {
			const key = parseKey(ticket);
			const repo = bodyRepo(ticket, group.repo);
			const blockedBy = bodyBlockers(ticket, repo, "blockedBy");
			const blocks = bodyBlockers(ticket, repo, "blocks");
			const earlier = parsed.get(key);
			if (earlier === undefined) {
				parsed.set(key, { blockedBy, blocks });
				continue;
			}
			parsed.set(key, {
				blockedBy: mergeBlockedBy([earlier.blockedBy, blockedBy]),
				blocks: mergeBlockedBy([earlier.blocks, blocks]),
			});
		}
	}
	return parsed;
}

export function openBlockers(
	ticket: Ticket,
	index: TicketIndex,
	parsed: ParsedBodies,
	groups: { project: string; tickets: Ticket[] }[] = [],
): Ticket[] {
	const self = asRef(ticket);
	const merged = self === null ? undefined : known(index, self);
	const incoming = (merged?.blockedBy ?? ticket.blockedBy).filter((ref) =>
		stillOpen(ref, index),
	);
	const fromBody = (parsed.get(parseKey(ticket))?.blockedBy ?? []).filter(
		(ref) => stillOpen(ref, index),
	);
	const fromBlocks: TicketRef[] = [];
	if (self !== null) {
		for (const [otherKey, lines] of parsed) {
			const other = index.get(otherKey);
			if (other === undefined || other.state !== "open") {
				continue;
			}
			if (!lines.blocks.some((ref) => sameRef(ref, self))) {
				continue;
			}
			const ref = asRef(other);
			if (ref !== null) {
				fromBlocks.push(ref);
			}
		}
		for (const group of groups) {
			for (const other of group.tickets) {
				if (other.state !== "open" || other === ticket) {
					continue;
				}
				const native = other.blocks ?? [];
				if (
					!native.some((ref) => sameRef(ref, self) && stillOpen(ref, index))
				) {
					continue;
				}
				const ref = asRef(other);
				if (ref !== null) {
					fromBlocks.push(ref);
				}
			}
		}
	}
	const refs = [...incoming, ...fromBody, ...fromBlocks];
	const resolved = refs.flatMap((ref) => {
		const blocker = known(index, ref);
		if (blocker !== undefined) {
			return [blocker];
		}
		return ref.state === "open" ? [outsideTicket(ref)] : [];
	});
	return resolved.filter((blocker, position) => {
		if (
			self !== null &&
			blocker.key !== null &&
			sameRef(self, { tracker: blocker.tracker, project: "", key: blocker.key })
		) {
			return false;
		}
		return (
			resolved.findIndex(
				(item) =>
					item.tracker === blocker.tracker &&
					foldKey(item.key) === foldKey(blocker.key),
			) === position
		);
	});
}

export type ListedProject = {
	key: string;
	name?: string;
	tracker: "github" | "linear";
	owner?: string;
	number?: number;
	updatedAt: string | null;
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
	board?: Board;
	closed?: boolean;
};

export function projectSnapshots(found: ListedProject[]): Snapshot[] {
	const kinds = new Map(
		found.map((project) => [project, listedRef(project).kind]),
	);
	const projects = [
		...found.filter((project) => kinds.get(project) === "github-project"),
		...found.filter((project) => kinds.get(project) !== "github-project"),
	];
	const shown = projects.filter((project) => project.closed !== true);
	const carried = new Map<string, Ticket>();
	for (const project of shown) {
		if (kinds.get(project) !== "github-repo") {
			continue;
		}
		for (const ticket of project.tickets) {
			if (ticket.ref !== undefined) {
				carried.set(ticket.ref, ticket);
			}
		}
	}
	const rows = [];
	for (const project of shown) {
		const repo = refRepo(listedRef(project));
		const tickets = project.tickets.map((ticket) => {
			const donor =
				ticket.ref === undefined ? undefined : carried.get(ticket.ref);
			const outgoing = bodyLines(donor, ticket);
			return donor === undefined || donor === ticket
				? ticket
				: {
						...ticket,
						body:
							ticket.body.trim() === ""
								? donor.body
								: `${ticket.body}\n${outgoing}`,
						blockedBy: mergeBlockedBy([
							donor.blockedBy,
							ticket.blockedBy,
							bodyBlockers(donor, bodyRepo(donor, repo), "blockedBy"),
							bodyBlockers(ticket, bodyRepo(ticket, repo), "blockedBy"),
						]),
					};
		});
		rows.push({
			key: project.key,
			name: project.name ?? project.key,
			tracker: project.tracker,
			tickets,
			pulls: project.pulls,
			branches: project.branches,
			startedKeys: project.startedKeys,
			...(project.board === undefined ? {} : { board: project.board }),
			...(project.owner === undefined ? {} : { owner: project.owner }),
			...(project.number === undefined ? {} : { number: project.number }),
		});
	}
	return claimTickets(rows);
}

/**
 * A ticket shows in one project only. The first row that lists its ref keeps
 * it, and GitHub project rows come before the other rows.
 */
function claimTickets(rows: Snapshot[]): Snapshot[] {
	const boardFirst = [
		...rows.filter((row) => listedRef(row).kind === "github-project"),
		...rows.filter((row) => listedRef(row).kind !== "github-project"),
	];
	const claimed = new Set<string>();
	const kept = new Map(
		boardFirst.map((row) => [
			row,
			row.tickets.filter((ticket) => {
				if (ticket.ref === undefined) {
					return true;
				}
				if (claimed.has(ticket.ref)) {
					return false;
				}
				claimed.add(ticket.ref);
				return true;
			}),
		]),
	);
	return rows.map((row) => ({ ...row, tickets: kept.get(row) ?? row.tickets }));
}

const githubNode = /^(\d+)-/;
const sessionSuffix = /\.[a-z][a-z0-9]*-\d+$/i;
const linearSegment = /^([a-z][a-z0-9]*)-(\d+)(?![a-z0-9])/i;

export function checkoutNamesProject(
	hasTrackerConfig: boolean,
	originOwner: string | null,
	viewer: { login: string; orgs: string[] } | null,
): boolean {
	if (hasTrackerConfig) {
		return true;
	}
	if (viewer === null || originOwner === null || originOwner.trim() === "") {
		return false;
	}
	const owner = originOwner.trim().toLowerCase();
	return [viewer.login, ...viewer.orgs].some(
		(name) => name.trim().toLowerCase() === owner,
	);
}

export function githubRepoForTodo(
	project: string,
	checkouts: { name: string; repo: string }[],
): string | null {
	const dot = project.indexOf(".");
	const name = (dot <= 0 ? project : project.slice(0, dot)).trim();
	if (name === "") {
		return null;
	}
	const node = dot <= 0 ? "" : project.slice(dot + 1);
	if (node === "main" || node.startsWith("pr-")) {
		return null;
	}
	const ticket = node.split(".")[0] ?? "";
	if (node !== "" && githubNode.test(ticket) !== true) {
		return null;
	}
	const checkout = checkouts.find((item) => item.name === name);
	if (checkout === undefined || ownerRepo.test(checkout.repo) !== true) {
		return null;
	}
	return checkout.repo;
}

export function checkoutBasenames(
	checkouts: (
		| { path: string; tracker: "github"; repo: string }
		| { path: string; tracker: "linear" }
	)[],
): { name: string; repo: string }[] {
	return checkouts.flatMap((checkout) => {
		if (checkout.tracker !== "github" || checkout.repo.trim() === "") {
			return [];
		}
		const name = checkout.path.split(/[/\\]/).at(-1) ?? "";
		if (name === "") {
			return [];
		}
		return [{ name, repo: checkout.repo.trim() }];
	});
}

export function linearNamesFromCheckouts(
	checkouts: (
		| { path: string; tracker: "github"; names: string[] }
		| { path: string; tracker: "linear"; names: string[] }
	)[],
	rows: { project: string }[],
): string[] {
	const names: string[] = [];
	for (const checkout of checkouts) {
		if (checkout.tracker !== "linear") {
			continue;
		}
		const checkoutName = checkout.path.split(/[/\\]/).at(-1) ?? "";
		names.push(...checkout.names);
		names.push(
			...rows.flatMap((row) => {
				if (!row.project.startsWith(`${checkoutName}.`)) {
					return [];
				}
				return row.project.replace(sessionSuffix, "").split(".").slice(1);
			}),
		);
	}
	return names;
}

export function linearKeysForNames(names: string[]): string[] {
	const keys: string[] = [];
	for (const name of names) {
		const bare = name.replace(sessionSuffix, "");
		for (const segment of bare.split(/[/_.]/)) {
			const match = segment.match(linearSegment);
			const team = match?.[1];
			const number = match?.[2];
			if (team === undefined || number === undefined) {
				continue;
			}
			const key = linearKey(team, number);
			if (!keys.includes(key)) {
				keys.push(key);
			}
		}
	}
	return keys;
}

const startedTodo = /^- \[ \] .+ \(([^,]+), in progress(?:: [^)]+)?\)/;

export function startedTodoKeys(
	listing: string,
	repos: { name: string; repo: string }[] = [],
): string[] {
	const keys: string[] = [];
	let project = "";
	for (const line of listing.split("\n")) {
		const heading = line.match(/^## (.+)$/);
		if (heading?.[1] !== undefined) {
			project = heading[1].split(".")[0]?.trim() ?? "";
			continue;
		}
		const key = line.match(startedTodo)?.[1];
		if (key === undefined) {
			continue;
		}
		const repo = repos.find((item) => item.name === project)?.repo;
		const scoped = scopedKey(repo ?? project, key);
		if (!keys.some((item) => sameTicketKey(item, scoped))) {
			keys.push(scoped);
		}
	}
	return keys;
}

function branchLinksTicket(branch: string, key: string): boolean {
	const number = keyNumber(key);
	const leading = branch.match(/^(?:[^/]+\/)?(\d+)-/)?.[1];
	if (leading !== undefined) {
		return number !== null && leading === number;
	}
	return keyTracker(key) === "github" && foldKey(branch).includes(foldKey(key));
}

function linked(ticket: Ticket, pulls: PullRequest[]): PullRequest[] {
	if (ticket.key === null) {
		return [];
	}
	const key = ticket.key;
	return pulls.filter((pull) => {
		const keys = [...pull.closingKeys, ...closingKeys(pull.body, pull.repo)];
		return (
			keys.some((item) => sameTicketKey(item, key)) ||
			branchLinksTicket(pull.branch, key)
		);
	});
}

function blockerProject(
	blocker: Ticket,
	ref: TicketRef | undefined,
	groups: { project: string; tickets: Ticket[] }[],
): string {
	const home = groups.find((group) => group.tickets.includes(blocker))?.project;
	if (home !== undefined) {
		return home;
	}
	if (ref?.projectName !== undefined && ref.projectName.trim() !== "") {
		return ref.projectName;
	}
	if (ref?.project !== undefined && ref.project !== "") {
		return ref.project;
	}
	if (blocker.tracker === "github" && blocker.key !== null) {
		return keyRepo(blocker.key) ?? "";
	}
	return "";
}

function outsideOf(
	blocker: Ticket,
	ref: TicketRef | undefined,
	groups: { project: string; tickets: Ticket[] }[],
): TicketRelation | null {
	if (blocker.key === null) {
		return null;
	}
	const project = blockerProject(blocker, ref, groups);
	if (project === "") {
		return null;
	}
	return {
		tracker: blocker.tracker,
		project,
		key: blocker.key,
		title: blocker.title.trim() || blocker.key,
	};
}

function graphLinks(
	ticket: Ticket,
	index: TicketIndex,
	parsed: ParsedBodies,
	groups: { project: string; tickets: Ticket[] }[],
): GraphLink[] {
	const self = asRef(ticket);
	const home = groups.find((group) => group.tickets.includes(ticket))?.project;
	const merged = self === null ? undefined : known(index, self);
	const incoming = mergeBlockedBy([
		merged?.blockedBy ?? ticket.blockedBy,
		parsed.get(parseKey(ticket))?.blockedBy ?? [],
	]);
	const links: GraphLink[] = [];
	const push = (ref: TicketRef, source: Ticket | undefined) => {
		if (
			links.some((item) => sameTicketKey(item.key, ref.key)) ||
			(self !== null && sameRef(self, ref))
		) {
			return;
		}
		const other = source ?? known(index, ref);
		const done =
			other?.state === "open"
				? false
				: ref.state === "closed" ||
					(other !== undefined
						? true
						: ref.state !== undefined && ref.state !== "open");
		const project =
			other === undefined ? "" : blockerProject(other, ref, groups);
		const outside =
			other === undefined ||
			project === "" ||
			home === undefined ||
			project.toLowerCase() === home.toLowerCase()
				? undefined
				: outsideOf(other, ref, groups);
		links.push({
			key: ref.key,
			done,
			...(outside === null || outside === undefined ? {} : { outside }),
		});
	};
	for (const ref of incoming) {
		push(ref, known(index, ref));
	}
	if (self !== null) {
		for (const [otherKey, lines] of parsed) {
			if (!lines.blocks.some((ref) => sameRef(ref, self))) {
				continue;
			}
			const other = index.get(otherKey);
			const ref = other === undefined ? null : asRef(other);
			if (ref !== null) {
				push(ref, other);
			}
		}
		for (const group of groups) {
			for (const other of group.tickets) {
				if (other === ticket) {
					continue;
				}
				const native = other.blocks ?? [];
				if (!native.some((ref) => sameRef(ref, self))) {
					continue;
				}
				const ref = asRef(other);
				if (ref !== null) {
					push(ref, other);
				}
			}
		}
	}
	return links;
}

function ticketRelations(
	ticket: Ticket,
	blockers: Ticket[],
	index: TicketIndex,
	parsed: ParsedBodies,
	groups: { project: string; tickets: Ticket[] }[],
): {
	blockers: string[];
	blockedBy: TicketRelation[];
	links: GraphLink[];
	outsideBlockers: TicketRelation[];
	blocks: TicketRelation[];
} {
	const self = asRef(ticket);
	const home = groups.find((group) => group.tickets.includes(ticket))?.project;
	const merged = self === null ? undefined : known(index, self);
	const incoming = [
		...(merged?.blockedBy ?? ticket.blockedBy),
		...(parsed.get(parseKey(ticket))?.blockedBy ?? []),
	];
	const keys: string[] = [];
	const blockedBy: TicketRelation[] = [];
	const outsideBlockers: TicketRelation[] = [];
	for (const blocker of blockers) {
		if (blocker.key === null) {
			continue;
		}
		keys.push(blocker.key);
		const source = incoming.find(
			(ref) =>
				ref.tracker === blocker.tracker &&
				foldKey(ref.key) === foldKey(blocker.key),
		);
		const project = blockerProject(blocker, source, groups) || home || "";
		if (project === "") {
			continue;
		}
		const relation: TicketRelation = {
			tracker: blocker.tracker,
			project,
			key: blocker.key,
			title: blocker.title.trim() || blocker.key,
		};
		blockedBy.push(relation);
		if (home !== undefined && project.toLowerCase() !== home.toLowerCase()) {
			outsideBlockers.push(relation);
		}
	}
	const blocks: TicketRelation[] = [];
	const ownBlocks = mergeBlockedBy([
		parsed.get(parseKey(ticket))?.blocks ?? [],
		merged?.blocks ?? ticket.blocks ?? [],
	]);
	const pushBlock = (ref: TicketRef, project: string, title: string) => {
		if (
			project === "" ||
			home === undefined ||
			blocks.some((item) => sameRef(item, ref))
		) {
			return;
		}
		blocks.push({
			tracker: ref.tracker,
			project,
			key: ref.key,
			title,
		});
	};
	if (self !== null) {
		for (const ref of ownBlocks) {
			if (ticket.state === "open" && !stillOpen(ref, index)) {
				continue;
			}
			const other = known(index, ref);
			const otherHome =
				other === undefined
					? undefined
					: groups.find((group) => group.tickets.includes(other))?.project;
			const project = otherHome ?? (ref.projectName?.trim() || ref.project);
			const title = other?.title.trim() || ref.title?.trim() || ref.key;
			pushBlock(ref, project, title);
		}
	}
	if (self !== null && ticket.state === "open") {
		for (const group of groups) {
			for (const other of group.tickets) {
				const otherRef = asRef(other);
				if (
					other.state !== "open" ||
					otherRef === null ||
					other === ticket ||
					blocks.some((item) => sameRef(item, otherRef))
				) {
					continue;
				}
				const refs = [
					...other.blockedBy,
					...(parsed.get(parseKey(other))?.blockedBy ?? []),
				];
				if (!refs.some((ref) => sameRef(ref, self) && stillOpen(self, index))) {
					continue;
				}
				pushBlock(otherRef, group.project, other.title.trim() || otherRef.key);
			}
		}
	}
	return {
		blockers: keys,
		blockedBy,
		links: graphLinks(ticket, index, parsed, groups),
		outsideBlockers,
		blocks,
	};
}

function linkedDoneKeys(
	name: string,
	relationsByKey: Map<string, ReturnType<typeof ticketRelations>>,
): Set<string> {
	const linked = new Set<string>();
	for (const [key, relations] of relationsByKey) {
		if (relations.blocks.length > 0) {
			linked.add(key);
		}
		for (const link of relations.links) {
			if (link.outside === undefined) {
				linked.add(foldKey(link.key));
			}
		}
		for (const blocked of relations.blocks) {
			if (blocked.project.toLowerCase() === name.toLowerCase()) {
				linked.add(foldKey(blocked.key));
			}
		}
	}
	return linked;
}

function stateByKey(reports: ProjectReport[]): Map<string, TicketState> {
	const states = new Map<string, TicketState>();
	for (const report of reports) {
		for (const ticket of report.tickets) {
			if (ticket.key === null) {
				continue;
			}
			states.set(itemId(report.name.toLowerCase(), ticket.key), ticket.state);
		}
	}
	return states;
}

function withEndStates(
	links: ShownGraphLink[],
	states: Map<string, TicketState>,
): ShownGraphLink[] {
	const end = (item: GraphEnd): GraphEnd => {
		if (item.state !== undefined) {
			return item;
		}
		const state = states.get(itemId(item.project.toLowerCase(), item.key));
		return state === undefined ? item : { ...item, state };
	};
	return links.map((link) => ({
		...link,
		from: end(link.from),
		to: end(link.to),
	}));
}

function shownGraph(
	name: string,
	tracker: "github" | "linear",
	views: TicketView[],
	relationsByKey: Map<string, ReturnType<typeof ticketRelations>>,
): { tickets: TicketView[]; links: ShownGraphLink[] } {
	const withKey = views.filter(
		(view): view is TicketView & { key: string } => view.key !== null,
	);
	const openKeys = new Set(
		withKey.flatMap((view) =>
			view.state === "done" ? [] : [foldKey(view.key)],
		),
	);
	const linked = linkedDoneKeys(name, relationsByKey);
	const shown = withKey.filter((view) => {
		const key = foldKey(view.key);
		return view.state !== "done" || (!openKeys.has(key) && linked.has(key));
	});
	const local = new Map(
		shown.map((view) => [foldKey(view.key), view] as const),
	);
	const links: ShownGraphLink[] = [];
	const seen = new Set<string>();
	const endOf = (
		project: string,
		key: string,
		title: string,
		tracker: "github" | "linear",
		state?: TicketState,
	): GraphEnd => ({
		project,
		key,
		tracker,
		title,
		...(state === undefined ? {} : { state }),
	});
	const push = (from: GraphEnd, to: GraphEnd, done: boolean) => {
		if (
			from.project.toLowerCase() === to.project.toLowerCase() &&
			sameTicketKey(from.key, to.key)
		) {
			return;
		}
		const id = linkId(
			itemId(from.project.toLowerCase(), from.key),
			itemId(to.project.toLowerCase(), to.key),
		);
		if (seen.has(id)) {
			return;
		}
		seen.add(id);
		links.push({ from, to, done });
	};
	for (const view of shown) {
		const relations = relationsByKey.get(foldKey(view.key));
		if (relations === undefined) {
			continue;
		}
		const target = endOf(name, view.key, view.title, tracker, view.state);
		for (const link of relations.links) {
			const outside = link.outside;
			const holder = local.get(foldKey(link.key));
			const source =
				outside === undefined
					? endOf(
							name,
							link.key,
							holder?.title ?? link.key,
							tracker,
							holder?.state,
						)
					: endOf(outside.project, outside.key, outside.title, outside.tracker);
			const onGraph = outside !== undefined || holder !== undefined;
			if (onGraph) {
				push(source, target, link.done);
			}
		}
		for (const blocked of relations.blocks) {
			if (blocked.project.toLowerCase() === name.toLowerCase()) {
				continue;
			}
			push(
				target,
				endOf(blocked.project, blocked.key, blocked.title, blocked.tracker),
				view.state === "done",
			);
		}
	}
	return { tickets: shown, links };
}

const botLogin: Record<KnownBot, string> = {
	grok: "grok-code-review[bot]",
	codex: "chatgpt-codex-connector[bot]",
	greptile: "greptile-apps[bot]",
};

const botCheck: Record<KnownBot, RegExp> = {
	grok: /grok/i,
	codex: /codex/i,
	greptile: /greptile/i,
};

const usageLimit = /usage limit/i;
const codexMarker = "<!-- codex-pull-request-review-summary -->";
const greptileMarker = "<!-- greptile_summary -->";
const codexRow = /^\|[^|\n]*\*\*([^*|\n]+)[^|\n]*\|([^|\n]*)\|/gm;

function expectedBotsFromHistory(
	pulls: Pick<
		PullRequest,
		"merged" | "checks" | "comments" | "reviews" | "reactions"
	>[],
): KnownBot[] {
	const found = new Set<KnownBot>();
	for (const pull of pulls) {
		if (!pull.merged) {
			continue;
		}
		for (const bot of knownBots) {
			if (pullShowsBot(pull, bot)) {
				found.add(bot);
			}
		}
	}
	return knownBots.filter((bot) => found.has(bot));
}

export function expectedBotsByRepo(
	pulls: Pick<
		PullRequest,
		"repo" | "merged" | "checks" | "comments" | "reviews" | "reactions"
	>[],
	overrides: Record<string, KnownBot[]>,
): Map<string, KnownBot[]> {
	const repos = new Set(pulls.map((pull) => pull.repo));
	const bots = new Map<string, KnownBot[]>();
	for (const repo of repos) {
		const saved = repoKey(overrides, repo);
		bots.set(
			repo,
			saved === undefined
				? expectedBotsFromHistory(pulls.filter((pull) => pull.repo === repo))
				: (overrides[saved] ?? []),
		);
	}
	return bots;
}

function pullShowsBot(
	pull: Pick<PullRequest, "checks" | "comments" | "reviews" | "reactions">,
	bot: KnownBot,
): boolean {
	const login = botLogin[bot];
	if (pull.checks.some((check) => botCheck[bot].test(check.name))) {
		return true;
	}
	if (pull.comments.some((comment) => comment.login === login)) {
		return true;
	}
	if (pull.reviews.some((review) => review.login === login)) {
		return true;
	}
	return pull.reactions.some((reaction) => reaction.login === login);
}

type BotPass = { done: boolean; warning: string | null };

function botPass(pull: PullRequest, bot: KnownBot): BotPass {
	if (bot === "codex" && eyesStillRunning(pull)) {
		return { done: false, warning: null };
	}
	const warning = botWarning(pull, bot);
	if (warning !== null) {
		return { done: true, warning };
	}
	if (bot === "grok") {
		const check = pull.checks.find((item) => botCheck.grok.test(item.name));
		const review = pull.reviews.find(
			(item) => item.login === botLogin.grok && item.commitId === pull.headSha,
		);
		const done = check?.status === "completed" && review !== undefined;
		return { done, warning: null };
	}
	if (bot === "codex") {
		const summary = pull.comments.find(
			(comment) =>
				comment.login === botLogin.codex && comment.body.includes(codexMarker),
		);
		const rows = [...(summary?.body.matchAll(codexRow) ?? [])];
		const completed =
			summary !== undefined &&
			rows.length > 0 &&
			rows.some((row) => (row[2] ?? "").includes("Completed"));
		const reactionOnly =
			summary === undefined &&
			pull.reactions.some(
				(reaction) =>
					reaction.login === botLogin.codex && reaction.content !== "eyes",
			);
		return { done: completed || reactionOnly, warning: null };
	}
	const summary = pull.comments.find(
		(comment) =>
			comment.login === botLogin.greptile &&
			comment.body.includes(greptileMarker),
	);
	const running = pull.checks.some(
		(check) =>
			botCheck.greptile.test(check.name) && check.status !== "completed",
	);
	return { done: summary !== undefined && !running, warning: null };
}

function botWarning(pull: PullRequest, bot: KnownBot): string | null {
	const check = pull.checks.find((item) => botCheck[bot].test(item.name));
	if (check?.status === "completed") {
		if (
			check.conclusion === "failure" ||
			check.conclusion === "cancelled" ||
			check.conclusion === "skipped" ||
			check.conclusion === "timed_out"
		) {
			return `${bot} ${check.conclusion}`;
		}
	}
	const login = botLogin[bot];
	const limited = pull.comments.some(
		(comment) =>
			comment.login === login &&
			usageLimit.test(comment.body) &&
			countsForHead(pull, bot, comment.createdAt),
	);
	return limited ? `${bot} usage limit` : null;
}

function eyesStillRunning(pull: PullRequest): boolean {
	const eyes = pull.reactions.filter(
		(reaction) =>
			reaction.login === botLogin.codex && reaction.content === "eyes",
	);
	if (eyes.length === 0) {
		return false;
	}
	if (eyes.some((reaction) => reaction.createdAt === null)) {
		return true;
	}
	const eyesAt = newestAt(eyes.map((reaction) => reaction.createdAt));
	const limitAt = newestAt(
		pull.comments
			.filter(
				(comment) =>
					comment.login === botLogin.codex && usageLimit.test(comment.body),
			)
			.map((comment) => comment.createdAt),
	);
	if (eyesAt === null || limitAt === null) {
		return true;
	}
	return Date.parse(eyesAt) >= Date.parse(limitAt);
}

function newestAt(times: (string | null)[]): string | null {
	let newest: string | null = null;
	for (const time of times) {
		if (time === null) {
			continue;
		}
		if (newest === null || Date.parse(time) > Date.parse(newest)) {
			newest = time;
		}
	}
	return newest;
}

function countsForHead(
	pull: PullRequest,
	bot: KnownBot,
	createdAt: string | null,
): boolean {
	if (bot !== "grok") {
		return true;
	}
	if (pull.headCommittedAt === null || createdAt === null) {
		return false;
	}
	return Date.parse(createdAt) > Date.parse(pull.headCommittedAt);
}

function reviewState(
	pulls: PullRequest[],
	expectedByRepo: Map<string, KnownBot[]>,
	comments: Comment[] = [],
): { state: "inReview" | "awaitingMerge" | null; tags: string[] } {
	const open = pulls.filter((pull) => !pull.merged);
	if (open.length === 0 || open.some((pull) => pull.draft)) {
		return { state: null, tags: [] };
	}
	const tags: string[] = [];
	let waiting = false;
	for (const pull of open) {
		const run = workcellRun(comments, pull);
		const cycle = run ?? botCycle(pull, expectedByRepo);
		for (const tag of cycle.tags) {
			tags.push(tag);
		}
		if (cycle.state === "inReview") {
			waiting = true;
		}
	}
	return { state: waiting ? "inReview" : "awaitingMerge", tags };
}

function botCycle(
	pull: PullRequest,
	expectedByRepo: Map<string, KnownBot[]>,
): { state: "inReview" | "awaitingMerge"; tags: string[] } {
	const tags: string[] = [];
	let waiting = false;
	for (const bot of expectedByRepo.get(pull.repo) ?? []) {
		const pass = botPass(pull, bot);
		if (pass.warning !== null) {
			tags.push(pass.warning);
		}
		if (!pass.done) {
			waiting = true;
		}
	}
	return { state: waiting ? "inReview" : "awaitingMerge", tags };
}

const stageLine = /^stage\s+(\d+)\b/i;
const progressStallLimitMs = 2 * 60 * 60 * 1000;
const mergeAskLine = /^Merge PR #(\d+)\b/i;
const finalReportLine = /^(?:ask-\d+:\s+\S+\s+)?final report\b/i;
const reportMarker = "<!-- workcell:report -->";
function pullNumbers(text: string): number[] {
	const numbers: number[] = [];
	for (const match of text.matchAll(/\/pull\/(\d+)\b/gi)) {
		const number = Number(match[1]);
		if (!numbers.includes(number)) {
			numbers.push(number);
		}
	}
	const asked = text.match(mergeAskLine)?.[1];
	if (asked !== undefined) {
		const number = Number(asked);
		if (!numbers.includes(number)) {
			numbers.push(number);
		}
	}
	return numbers;
}

function isReportComment(body: string): boolean {
	if (body.includes(reportMarker)) {
		return true;
	}
	const first = body.split("\n")[0]?.trim() ?? "";
	return askId(body) !== null && finalReportLine.test(first);
}

function commentsAfter(comments: Comment[], progress: Comment): Comment[] {
	const progressAt = comments.indexOf(progress);
	return comments.slice(progressAt + 1);
}

function progressComment(comments: Comment[]):
	| {
			progress: Comment;
			lines: string[];
			later: Comment[];
			reportAt: number;
			report: Comment | undefined;
	  }
	| undefined {
	const progress = comments.find(
		(comment) => comment.body.split("\n")[0]?.trim() === progressHeading,
	);
	if (progress === undefined) {
		return undefined;
	}
	const lines = progress.body
		.split("\n")
		.map((line) => line.trim().replace(/^-\s*/, ""))
		.filter((line) => line !== "" && line !== progressHeading);
	const later = commentsAfter(comments, progress);
	return {
		progress,
		lines,
		later,
		reportAt: lines.findLastIndex((line) => finalReportLine.test(line)),
		report: later.findLast(
			(comment) => comment !== progress && isReportComment(comment.body),
		),
	};
}

function resumedAfterReport(
	found: NonNullable<ReturnType<typeof progressComment>>,
	countsStage: (line: string) => boolean = (line) => stageLine.test(line),
): boolean {
	const { lines, reportAt, report } = found;
	if (reportAt < 0 && report === undefined) {
		return false;
	}
	const reportAsk = report === undefined ? null : askId(report.body);
	return lines
		.slice(reportAt < 0 ? lines.length : reportAt + 1)
		.some(
			(line) =>
				countsStage(line) ||
				(reportAsk !== null && progressAnswers(line, reportAsk)),
		);
}

function progressRun(comments: Comment[], now: Date): LiveRun | undefined {
	const found = progressComment(comments);
	if (found === undefined) {
		return undefined;
	}
	const { lines, reportAt, progress } = found;
	const resumed = resumedAfterReport(found);
	const counted = resumed || reportAt < 0 ? lines : lines.slice(0, reportAt);
	let stage: string | undefined;
	for (const line of counted) {
		const stageMatch = line.match(stageLine);
		if (stageMatch?.[1] === undefined) {
			continue;
		}
		stage = `stage ${stageMatch[1]}`;
	}
	if (stage === undefined) {
		return undefined;
	}
	const open = resumed || reportAt < 0;
	const stalled = open && progressOlderThanStallLimit(progress, now);
	return {
		status: stalled ? "failed" : "running",
		stage,
	};
}

function progressOlderThanStallLimit(progress: Comment, now: Date): boolean {
	const updatedAt = progress.updatedAt;
	if (updatedAt === undefined) {
		return false;
	}
	const updated = Date.parse(updatedAt);
	if (Number.isNaN(updated)) {
		return false;
	}
	return now.getTime() - updated > progressStallLimitMs;
}

function workcellRun(
	comments: Comment[],
	pull: PullRequest,
): { state: "inReview" | "awaitingMerge"; tags: string[] } | null {
	const found = progressComment(comments);
	if (found === undefined) {
		return null;
	}
	const { lines, later, reportAt, report } = found;
	if (reportAt >= 0 || report !== undefined) {
		if (
			resumedAfterReport(
				found,
				(line) => stageLine.test(line) && !namesAnotherPull(line, pull),
			)
		) {
			return { state: "inReview", tags: [] };
		}
		if (report !== undefined && commentNamesPull(report.body, pull.number)) {
			const open =
				askId(report.body) === null || askAnswer(comments, report) === null;
			return { state: open ? "awaitingMerge" : "inReview", tags: [] };
		}
		if (reportAt >= 0 && lineDecidesPull(lines[reportAt] ?? "", pull, lines)) {
			return { state: "awaitingMerge", tags: [] };
		}
	}
	const mergeAsk = openMergeAsk(later, pull.number);
	if (mergeAsk !== undefined && askAnswer(comments, mergeAsk) === null) {
		return { state: "awaitingMerge", tags: [] };
	}
	let stage: number | null = null;
	for (const line of lines) {
		const stageMatch = line.match(stageLine);
		if (stageMatch?.[1] !== undefined && lineDecidesPull(line, pull, lines)) {
			stage = Number(stageMatch[1]);
		}
	}
	if (stage !== null && stage <= 5) {
		return { state: "inReview", tags: [] };
	}
	return null;
}

function lineDecidesPull(
	line: string,
	pull: PullRequest,
	lines: string[],
): boolean {
	const numbers = pullNumbers(line);
	if (numbers.length > 0) {
		return numbers.includes(pull.number);
	}
	return !lines.some((item) => pullNumbers(item).length > 0);
}

function namesAnotherPull(line: string, pull: PullRequest): boolean {
	const numbers = pullNumbers(line);
	return numbers.length > 0 && !numbers.includes(pull.number);
}

function commentNamesPull(body: string, number: number): boolean {
	const numbers = pullNumbers(body);
	return numbers.length === 0 || numbers.includes(number);
}

function openMergeAsk(later: Comment[], number: number): Comment | undefined {
	return later.findLast((comment) => {
		if (
			askId(comment.body) === null ||
			!commentNamesPull(comment.body, number)
		) {
			return false;
		}
		const first = comment.body.split("\n")[0]?.trim() ?? "";
		return (
			first.match(mergeAskLine)?.[1] === String(number) ||
			comment.body.includes(reportMarker) ||
			finalReportLine.test(first)
		);
	});
}

function laterState(current: TicketState, next: TicketState): TicketState {
	const currentAt = statusTypeOrder.indexOf(current);
	const nextAt = statusTypeOrder.indexOf(next);
	return nextAt > currentAt ? next : current;
}

function runFor(ticket: Ticket, runs: WorkcellRun[]): WorkcellRun | undefined {
	const key = ticket.key;
	if (key === null) {
		return undefined;
	}
	return runs.find((run) => {
		if (sameTicketKey(run.key, key)) {
			return true;
		}
		if (run.repo === undefined) {
			return false;
		}
		return sameTicketKey(githubKey(run.repo, run.key), key);
	});
}

function closesTicket(pull: PullRequest, ticket: Ticket): boolean {
	const key = ticket.key;
	if (key === null || !pull.merged) {
		return false;
	}
	return closingKeys(pull.body, pull.repo).some((item) =>
		sameTicketKey(item, key),
	);
}

export type ShownTicket = {
	state: TicketState;
	lane: Lane;
	staleStatus?: string;
	chips: string[];
	runFailed: boolean;
	enteredStateAt: string;
	blocked: boolean;
	run?: LiveRun;
};

function enteredStateAt(ticket: Ticket, lane: Lane): string {
	const history = ticket.history ?? [];
	let entered: string | undefined;
	for (const change of history) {
		const sameLane = change.statusId === lane.id;
		const sameType =
			change.statusType !== undefined && change.statusType === lane.statusType;
		if ((sameLane || sameType) && change.at !== "") {
			entered =
				entered === undefined || change.at > entered ? change.at : entered;
		}
	}
	const closedType = closedLaneType(ticket);
	const closedAt = ticket.closedAt;
	if (
		closedType !== undefined &&
		closedType === lane.statusType &&
		closedAt !== undefined &&
		closedAt !== "" &&
		(entered === undefined || closedAt > entered)
	) {
		entered = closedAt;
	}
	if (entered !== undefined) {
		return entered;
	}
	if (lane.statusType === "backlog") {
		const createdAt = ticket.createdAt?.trim() ?? "";
		if (createdAt !== "") {
			return createdAt;
		}
	}
	return ticket.updatedAt;
}

function shownTicket(
	ticket: Ticket,
	lane: Lane,
	links: PullRequest[],
	branches: string[],
	startedKeys: string[],
	review: { state: "inReview" | "awaitingMerge" | null },
	runs: WorkcellRun[],
	autoMerge: boolean,
	lanes: Lane[],
	now: Date,
	openBlockerCount: number,
): ShownTicket {
	const trackerState = lane.statusType;
	let state = trackerState;
	const key = ticket.key;
	const started =
		key !== null && startedKeys.some((item) => sameTicketKey(item, key));
	const pushed =
		key !== null && branches.some((branch) => branchLinksTicket(branch, key));
	const draft = links.some((pull) => pull.draft);
	const local = runFor(ticket, runs);
	const fromComment = progressRun(ticket.comments ?? [], now);
	const stage = fromComment?.stage;
	const run =
		local === undefined
			? fromComment
			: {
					status: local.status,
					...(stage === undefined ? {} : { stage }),
				};
	const live = run?.status === "running";
	const mergedClose = links.some(
		(pull) => pull.merged && closesTicket(pull, ticket),
	);
	const failed = run?.status === "failed" && !mergedClose;
	const open = links.filter((pull) => !pull.merged);
	if (
		!failed &&
		ticket.state === "open" &&
		(draft || pushed || started || (live && open.length === 0))
	) {
		state = laterState(state, "inProgress");
	}
	if (!failed && ticket.state === "open" && review.state !== null) {
		const reviewed =
			review.state === "awaitingMerge" && autoMerge ? "inReview" : review.state;
		state = laterState(state, reviewed);
	}
	if (ticket.state === "open" && mergedClose) {
		state = laterState(state, "done");
	}
	const shownLane =
		failed || state === trackerState
			? lane
			: (lanes.find(
					(item) =>
						item.statusType === state && item.name === appLaneNames[state],
				) ??
				lanes.find((item) => item.statusType === state) ??
				lane);
	const chips: string[] = [];
	let staleStatus: string | undefined;
	if (
		ticket.status !== undefined &&
		shownLane.statusType !== ticket.status.statusType &&
		ticket.status.name !== ""
	) {
		staleStatus = ticket.status.name;
		chips.push(staleStatus);
	}
	const runFailed =
		failed && ticket.state === "open" && shownLane.statusType !== "done";
	if (runFailed) {
		chips.push("Run failed");
	}
	const shownRun =
		run !== undefined && ticket.state === "open" && (live || failed)
			? run
			: undefined;
	return {
		state: shownLane.statusType,
		lane: shownLane,
		...(staleStatus === undefined ? {} : { staleStatus }),
		chips,
		runFailed,
		enteredStateAt: enteredStateAt(ticket, shownLane),
		blocked: ticket.state === "open" && openBlockerCount > 0,
		...(shownRun === undefined ? {} : { run: shownRun }),
	};
}

function assigneesOf(
	ticket: Ticket,
): { assignees: string[] } | Record<string, never> {
	const names = [
		...(ticket.assignees ?? []),
		...(ticket.assignee === undefined || ticket.assignee === null
			? []
			: [ticket.assignee]),
	].flatMap((name) => {
		const trimmed = name.trim();
		return trimmed === "" ? [] : [trimmed];
	});
	return names.length === 0 ? {} : { assignees: [...new Set(names)] };
}

function chipsOf(
	shown: ShownTicket,
): { chips: string[] } | Record<string, never> {
	const chips = shown.blocked ? [...shown.chips, "Blocked"] : shown.chips;
	return chips.length === 0 ? {} : { chips };
}

type AutoMergeSources = {
	config: Record<string, AutoMerge>;
	workcell: Record<string, AutoMerge>;
	repo: Record<string, boolean>;
};

function mergesOnItsOwn(
	links: PullRequest[],
	project: string,
	projectKey: string,
	auto: AutoMergeSources,
): boolean {
	const open = links.filter((pull) => !pull.merged);
	if (open.length === 0) {
		return false;
	}
	return open.every((pull) => {
		const configured =
			auto.config[pull.repo] ?? auto.config[projectKey] ?? auto.config[project];
		if (configured !== undefined) {
			return configured === "yes";
		}
		const workcell = auto.workcell[pull.repo];
		if (workcell !== undefined) {
			return workcell === "yes";
		}
		return pull.autoMerge === true || auto.repo[pull.repo] === true;
	});
}

export function projectCounts(
	name: string,
	key: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
	pulls: PullRequest[],
	branches: string[],
	startedKeys: string[],
	runs: WorkcellRun[],
	autoMerge: AutoMergeSources,
	all: ProjectGroup[],
	expectedBots: Map<string, KnownBot[]>,
	status: FetchStatus,
	rules: Omit<NeedsYouRules, "pmBot"> & {
		pmBot: Record<string, boolean>;
	},
	laneMappings: Configuration["laneMappings"],
	now: Date,
	colours: StatusColours,
	board?: Board,
): {
	counts: ProjectBody;
	needsYou: NeedsYouItem[];
	report: ProjectReport;
} {
	const index = indexTickets(all.flatMap((group) => group.tickets));
	const parsed = parseBodies(all);
	const counts = {
		done: 0,
		dropped: 0,
		blocked: 0,
		backlog: 0,
		inProgress: 0,
		inReview: 0,
		awaitingMerge: 0,
	};
	const statusTypes = emptyStatusTypes();
	const mappingKey = board?.laneKey;
	const mapping =
		mappingKey === undefined ? {} : (laneMappings[mappingKey] ?? {});
	const lanes = placeOnBoard(
		lanesFor(board, mapping, colours),
		tickets,
		colours,
	);
	const tags = new Set<string>();
	const views: TicketView[] = [];
	const relationsByKey = new Map<string, ReturnType<typeof ticketRelations>>();
	const pullByKey = new Map<string, PullRequest>();
	const shownByKey = new Map<string, TicketState>();
	const failedKeys = new Set<string>();
	const runByKey = new Map<string, LiveRun>();
	const cross = new Map<string, CrossProjectBlocker>();
	const active = pulls.filter((pull) => !pull.merged);
	const linkedByTicket = new Map<string, PullRequest[]>();
	const linkedKeys = new Set<string>();
	const subTickets = subTicketCounts(tickets);
	for (const ticket of tickets) {
		const blockers = openBlockers(ticket, index, parsed, all);
		const links = linked(ticket, pulls);
		for (const pull of links) {
			linkedKeys.add(pullKey(pull));
		}
		if (ticket.state === "open" && ticket.key !== null) {
			linkedByTicket.set(ticket.key, links);
		}
		const review = reviewState(links, expectedBots, ticket.comments ?? []);
		for (const tag of review.tags) {
			tags.add(tag);
		}
		const lane = laneForTicket(ticket, lanes, colours);
		const mergesAlone = mergesOnItsOwn(links, name, key, autoMerge);
		const shown = shownTicket(
			ticket,
			lane,
			links,
			branches,
			startedKeys,
			review,
			runs,
			mergesAlone,
			lanes,
			now,
			blockers.length,
		);
		if (ticket.key !== null) {
			shownByKey.set(ticket.key, shown.state);
			if (shown.runFailed) {
				failedKeys.add(ticket.key);
			}
			if (shown.run !== undefined) {
				runByKey.set(foldKey(ticket.key), shown.run);
			}
		}
		if (blockers.length > 0 && ticket.state === "open") {
			counts.blocked += 1;
		}
		counts[shown.state] += 1;
		statusTypes[shown.lane.statusType] += 1;
		if (ticket.key !== null) {
			relationsByKey.set(
				foldKey(ticket.key),
				ticketRelations(ticket, blockers, index, parsed, all),
			);
			const pull = links[0];
			if (pull !== undefined) {
				pullByKey.set(foldKey(ticket.key), pull);
			}
		}
		views.push({
			key: ticket.key,
			title: ticket.title,
			state: shown.state,
			blockers: blockers.flatMap((blocker) =>
				blocker.key === null ? [] : [blocker.key],
			),
			lane: shown.lane.name,
			statusType: shown.lane.statusType,
			...(blockers.length > 0 && ticket.state === "open"
				? { blocked: true }
				: {}),
			...(shown.staleStatus === undefined
				? {}
				: { staleStatus: shown.staleStatus }),
			...chipsOf(shown),
			enteredStateAt: shown.enteredStateAt,
			...(ticket.updatedAt === "" ? {} : { updatedAt: ticket.updatedAt }),
			...assigneesOf(ticket),
			...(ticket.parent === null ? {} : { parent: ticket.parent }),
			...countOf(subTickets, ticket.key),
		});
		if (blockers.length === 0 || ticket.state !== "open") {
			continue;
		}
		for (const blocker of blockers) {
			if (blocker.key === null) {
				continue;
			}
			const self = asRef(ticket);
			const merged = self === null ? undefined : known(index, self);
			const source = [
				...(merged?.blockedBy ?? ticket.blockedBy),
				...(parsed.get(parseKey(ticket))?.blockedBy ?? []),
			].find(
				(ref) =>
					ref.tracker === blocker.tracker &&
					foldKey(ref.key) === foldKey(blocker.key),
			);
			const project = blockerProject(blocker, source, all);
			if (project === "" || project.toLowerCase() === name.toLowerCase()) {
				continue;
			}
			const crossBlocker = {
				project,
				tracker: blocker.tracker,
				key: blocker.key,
				title: blocker.title,
			};
			cross.set(ticketRefId(crossBlocker), crossBlocker);
		}
	}
	const unlinked = active.filter((pull) => !linkedKeys.has(pullKey(pull)));
	const unlinkedPrs = unlinked.map((pull) => ({
		number: pull.number,
		title: pull.title,
		url: pull.url,
		repo: pull.repo,
	}));
	const needsYouItemsForProject = needsYouItems(
		name,
		tracker,
		tickets,
		active,
		unlinked,
		linkedByTicket,
		expectedBots,
		shownByKey,
		failedKeys,
		{
			labels: rules.labels,
			viewerLogins: rules.viewerLogins,
			pmBot: projectHasPmBot(rules.pmBot, key, tracker),
		},
		autoMerge,
		key,
	);
	const unlinkedReview = reviewState(unlinked, expectedBots, []);
	for (const tag of unlinkedReview.tags) {
		tags.add(tag);
	}
	const project: ProjectBody = {
		name,
		tracker,
		...counts,
		unlinkedPrs,
		tickets: withSubTicketCounts(views),
		crossProjectBlockers: [...cross.values()],
		needsYou: needsYouItemsForProject.length,
		progress: progressRatio(counts),
		...staleView(status, status.fetchedAt),
		tags: [...tags],
		statusTypes,
	};
	const report = projectReport(
		project,
		tickets,
		lanes,
		relationsByKey,
		pullByKey,
		needsYouItemsForProject,
		runByKey,
		outsideParents(tickets, all),
	);
	return {
		counts: project,
		needsYou: needsYouItemsForProject,
		report,
	};
}

function withSubTicketCounts(views: TicketView[]): TicketView[] {
	const subTicketsByKey = new Map<string, TicketView[]>();
	for (const view of views) {
		const parent = foldKey(view.parent);
		if (parent === undefined || parent === foldKey(view.key)) {
			continue;
		}
		subTicketsByKey.set(parent, [...(subTicketsByKey.get(parent) ?? []), view]);
	}
	const subTicketsOf = (view: TicketView) =>
		view.key === null ? [] : (subTicketsByKey.get(foldKey(view.key)) ?? []);
	const settled = new Map<TicketView, boolean>();
	const allClosed = (view: TicketView): boolean => {
		const known = settled.get(view);
		if (known !== undefined) {
			return known;
		}
		settled.set(view, true);
		const result = subTicketsOf(view).every(
			(sub) =>
				(sub.statusType === "done" || sub.statusType === "dropped") &&
				allClosed(sub),
		);
		settled.set(view, result);
		return result;
	};
	return views.map((view) => {
		const below = subTicketsOf(view);
		if (below.length === 0) {
			return view;
		}
		return {
			...view,
			subTicketsDone: below.filter((sub) => sub.statusType === "done").length,
			...(allClosed(view) ? { startsCollapsed: true as const } : {}),
		};
	});
}

/** The hidden parent tickets above the shown graph tickets, up to each top parent ticket. */
function graphParentsOf(
	graphTickets: readonly TicketView[],
	tickets: readonly TicketView[],
): TicketView[] {
	const byKey = new Map(
		tickets.flatMap((ticket) =>
			ticket.key === null ? [] : [[foldKey(ticket.key), ticket] as const],
		),
	);
	const shown = new Set(
		graphTickets.flatMap((ticket) =>
			ticket.key === null ? [] : [foldKey(ticket.key)],
		),
	);
	const found = new Map<string, TicketView>();
	for (const ticket of graphTickets) {
		let parent = foldKey(ticket.parent);
		while (parent !== undefined && !shown.has(parent) && !found.has(parent)) {
			const view = byKey.get(parent);
			if (view === undefined) {
				break;
			}
			found.set(parent, view);
			parent = foldKey(view.parent);
		}
	}
	return [...found.values()];
}

function subTicketCounts(tickets: Ticket[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const ticket of tickets) {
		if (ticket.parent !== null) {
			const key = foldKey(ticket.parent);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}

function countOf(
	counts: Map<string, number>,
	key: string | null,
): { subTickets?: number } {
	const count = key === null ? undefined : counts.get(foldKey(key));
	return count === undefined ? {} : { subTickets: count };
}

function outsideParents(
	tickets: Ticket[],
	all: { project: string; tickets: Ticket[] }[],
): OutsideParent[] {
	const own = new Set(
		tickets.flatMap((ticket) =>
			ticket.key === null ? [] : [foldKey(ticket.key)],
		),
	);
	const found = new Map<string, OutsideParent>();
	for (const ticket of tickets) {
		const key = ticket.parent;
		const details = ticket.parentDetails;
		if (key === null || details === undefined || own.has(foldKey(key))) {
			continue;
		}
		const home =
			all.find((group) =>
				group.tickets.some(
					(other) => other.key !== null && sameTicketKey(other.key, key),
				),
			)?.project ??
			all.find(
				(group) =>
					details.project !== "" &&
					group.project.toLowerCase() === details.project.toLowerCase(),
			)?.project;
		found.set(foldKey(key), {
			tracker: ticket.tracker,
			project: home ?? details.project,
			key,
			title: details.title.trim() || key,
			...(details.state === undefined ? {} : { state: details.state }),
			url: details.url,
			tracked: home !== undefined,
		});
	}
	return [...found.values()];
}

const stateKeys = [
	"done",
	"dropped",
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
] as const;

function progressRatio(
	counts: Pick<ProjectCounts, (typeof stateKeys)[number]>,
): number {
	const total = stateKeys.reduce((sum, state) => sum + counts[state], 0);
	if (total === 0) {
		return 0;
	}
	return Math.round((counts.done / total) * 100);
}

const decisionRecord = /^\**\s*decision\b/i;
const nameCue =
	/\b(?:waits on|held for|left for|decision|verify|restore|passphrase|signing key)\b/i;

export type NeedsYouRules = {
	pmBot: boolean;
	labels: string[];
	viewerLogins: string[];
};

export function projectHasPmBot(
	pmBot: Record<string, boolean>,
	key: string,
	tracker: "github" | "linear",
): boolean {
	const match = Object.entries(pmBot).find(
		([name]) => name.toLowerCase() === key.toLowerCase(),
	);
	return match?.[1] ?? tracker === "github";
}

function ciOf(pull: PullRequest): PullStatus["ci"] {
	if (pull.checks.length === 0) {
		return "none";
	}
	if (
		pull.checks.some(
			(check) =>
				check.conclusion === "failure" ||
				check.conclusion === "cancelled" ||
				check.conclusion === "timed_out",
		)
	) {
		return "failing";
	}
	if (
		pull.checks.some(
			(check) => check.status !== "completed" || check.conclusion === null,
		)
	) {
		return "pending";
	}
	if (
		pull.checks.every(
			(check) =>
				check.conclusion === "success" ||
				check.conclusion === "skipped" ||
				check.conclusion === "neutral",
		)
	) {
		return "passing";
	}
	return "pending";
}

function reviewOf(pull: PullRequest): PullStatus["review"] {
	const latest = new Map<string, BotReview>();
	for (const review of pull.reviews) {
		if (review.commitId !== pull.headSha || review.state === "COMMENTED") {
			continue;
		}
		latest.set(review.login, review);
	}
	const decided = [...latest.values()];
	if (decided.some((review) => review.state === "CHANGES_REQUESTED")) {
		return "changes";
	}
	if (decided.some((review) => review.state === "APPROVED")) {
		return "approved";
	}
	const onHead = pull.reviews.filter(
		(review) => review.commitId === pull.headSha,
	);
	const completed = knownBots.some((bot) => {
		if (!botPass(pull, bot).done) {
			return false;
		}
		return onHead.some(
			(review) =>
				review.login === botLogin[bot] &&
				review.state !== "APPROVED" &&
				review.state !== "CHANGES_REQUESTED",
		);
	});
	if (completed) {
		return "completed";
	}
	if (onHead.length > 0) {
		return "pending";
	}
	return "none";
}

function pullStatus(pull: PullRequest): PullStatus {
	return {
		number: pull.number,
		title: pull.title,
		url: pull.url,
		ci: ciOf(pull),
		review: reviewOf(pull),
	};
}

function opensForSenior(body: string): boolean {
	const opening = body.trim().slice(0, 240).toLowerCase();
	return /\b(?:senior|for the senior)\b/.test(opening);
}

function matchedByName(body: string): boolean {
	if (!namesLev(body)) {
		return false;
	}
	const cueAt = body.search(nameCue);
	const nameAt = body.search(/\blev\b/i);
	return cueAt >= 0 && nameAt >= 0 && Math.abs(cueAt - nameAt) <= 80;
}

function addressedToLev(body: string, pmBot: boolean): boolean {
	if (decisionRecord.test(body.trim())) {
		return false;
	}
	const named = matchedByName(body);
	if (opensForSenior(body) && !namesLev(body)) {
		return false;
	}
	if (pmBot) {
		return named;
	}
	return true;
}

export function optionReplyBody(
	ticket: Ticket | undefined,
	option: number,
	pmBot: boolean,
): string | null {
	const ask = openAsk(ticket?.comments ?? [], pmBot);
	const picked = ask?.options.find((item) => item.number === option);
	if (ask === null || picked === undefined) {
		return null;
	}
	return `${picked.number}. ${picked.label}`;
}

export function panelReplyBody(
	ticket: Ticket | undefined,
	body: string,
	pmBot: boolean,
	parentId?: string,
): string {
	const text = body.trim();
	const ask = openAsk(ticket?.comments ?? [], pmBot);
	if (ask === null || ask.answer !== null) {
		return text;
	}
	if (parentId !== undefined && parentId !== ask.comment.id) {
		return text;
	}
	if (ask.headline === "") {
		return text;
	}
	return `> ${ask.headline}\n\n${text}`;
}

type OpenAsk = Ask & { tags: string[] };

function openAsk(comments: Comment[], pmBot: boolean): OpenAsk | null {
	const ask = readAsks(comments)
		.filter(
			(item) =>
				item.answer?.by !== "record" &&
				addressedToLev(item.comment.body, pmBot),
		)
		.at(-1);
	if (ask === undefined) {
		return null;
	}
	return {
		...ask,
		tags: matchedByName(ask.comment.body) ? ["matched by name"] : [],
	};
}

function assignedToViewer(ticket: Ticket, viewers: Set<string>): boolean {
	const names = [
		...(ticket.assignees ?? []),
		...(ticket.assignee === undefined || ticket.assignee === null
			? []
			: [ticket.assignee]),
	];
	return names.some((name) => {
		const trimmed = name.trim().toLowerCase();
		return trimmed !== "" && viewers.has(trimmed);
	});
}

function needsYouItem(
	project: string,
	tracker: ProjectCounts["tracker"],
	key: string,
	title: string,
	ask: OpenAsk | null,
	reason: NeedsYouItem["reason"],
	pulls: PullRequest[] = [],
): NeedsYouItem {
	const reply = ask?.answer?.comment ?? null;
	const pull = pulls.find((item) => !item.merged) ?? pulls[0];
	return {
		project,
		tracker,
		key,
		headline: ask?.headline ?? title,
		reason,
		tags: ask?.tags ?? [],
		answered: reply !== null,
		acknowledged: (reply?.reactions ?? 0) > 0,
		...(ask === null ? {} : { question: ask.question, options: ask.options }),
		...(pull === undefined ? {} : { pull: pullStatus(pull) }),
	};
}

function pullComments(pull: PullRequest): Comment[] {
	return pull.comments.map((comment) => ({
		body: comment.body,
		...(comment.createdAt === null ? {} : { createdAt: comment.createdAt }),
		author: comment.login,
		...(comment.reactions === undefined
			? {}
			: { reactions: comment.reactions }),
	}));
}

export function needsYouItems(
	project: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
	pulls: PullRequest[],
	unlinkedPulls: PullRequest[],
	linkedByTicket: Map<string, PullRequest[]>,
	expectedBots: Map<string, KnownBot[]>,
	shownByKey: Map<string, TicketState>,
	failedKeys: Set<string>,
	rules: NeedsYouRules,
	autoMerge: AutoMergeSources,
	projectKey: string,
): NeedsYouItem[] {
	const labels = new Set(rules.labels.map((label) => label.toLowerCase()));
	const viewers = new Set(
		rules.viewerLogins.map((login) => login.toLowerCase()),
	);
	const items: NeedsYouItem[] = [];
	for (const ticket of tickets) {
		if (ticket.state !== "open" || ticket.key === null) {
			continue;
		}
		const shown = shownByKey.get(ticket.key);
		const linkedPulls = linkedByTicket.get(ticket.key) ?? [];
		const comments = [
			...(ticket.comments ?? []),
			...linkedPulls.flatMap(pullComments),
		];
		const ask = openAsk(comments, rules.pmBot);
		const labelled =
			assignedToViewer(ticket, viewers) &&
			ticket.labels.some((label) => labels.has(label.toLowerCase()));
		const awaiting = shown === "awaitingMerge";
		const failed = failedKeys.has(ticket.key);
		if (ask === null && !labelled && !awaiting && !failed) {
			continue;
		}
		items.push(
			needsYouItem(
				project,
				tracker,
				ticket.key,
				ticket.title,
				ask,
				ask !== null
					? "ask"
					: awaiting
						? "awaitingMerge"
						: failed
							? "runFailed"
							: "label",
				linkedPulls,
			),
		);
	}
	const folded = new Set(
		[...linkedByTicket.values()].flat().map((pull) => pullKey(pull)),
	);
	for (const pull of pulls) {
		if (folded.has(pullKey(pull))) {
			continue;
		}
		const comments = pullComments(pull);
		const ask = openAsk(comments, rules.pmBot);
		if (ask === null) {
			continue;
		}
		items.push(
			needsYouItem(project, "github", pullKey(pull), pull.title, ask, "ask", [
				pull,
			]),
		);
	}
	const listed = new Set(items.map((item) => item.key));
	for (const pull of unlinkedPulls) {
		const key = pullKey(pull);
		if (listed.has(key)) {
			continue;
		}
		if (reviewState([pull], expectedBots, []).state !== "awaitingMerge") {
			continue;
		}
		if (mergesOnItsOwn([pull], project, projectKey, autoMerge)) {
			continue;
		}
		items.push(
			needsYouItem(project, "github", key, pull.title, null, "awaitingMerge", [
				pull,
			]),
		);
	}
	items.sort((left, right) => Number(left.answered) - Number(right.answered));
	return items;
}

const noScope = "no scope";
const noWorkstream = "no workstream";
const noAssignee = "no assignee";

const scopeInTitle = /^(?:[a-z]+)\(([^)]+)\)!?\s*:|^\[([^\]]+)\]/i;

function scopeOf(title: string): string {
	const match = title.match(scopeInTitle);
	const scope = match?.[1] ?? match?.[2];
	if (scope === undefined || scope.trim() === "") {
		return noScope;
	}
	return scope.trim().toLowerCase();
}

type Placed = {
	ticket: Ticket;
	view: TicketView;
	workstream: string;
	workstreamKey: string;
	theme: string;
	themeGroup: string;
};

function parentOf(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): Ticket | undefined {
	const parentKey = ticket.parent;
	if (parentKey === null) {
		return undefined;
	}
	return byKey.get(foldKey(parentKey));
}

function* ancestors(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): Generator<Ticket> {
	const seen = new Set<string>();
	let current = ticket;
	for (;;) {
		const parent = parentOf(current, byKey);
		if (parent === undefined || parent.key === null) {
			return;
		}
		const key = foldKey(parent.key);
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		yield parent;
		current = parent;
	}
}

function rootOf(ticket: Ticket, byKey: Map<string, Ticket>): Ticket {
	let root = ticket;
	for (const parent of ancestors(ticket, byKey)) {
		root = parent;
	}
	return root;
}

function isEpic(ticket: Ticket): boolean {
	return ticket.labels.some((label) => label.toLowerCase() === "epic");
}

function themeOf(
	ticket: Ticket,
	root: Ticket,
	byKey: Map<string, Ticket>,
	parents: ReadonlyMap<string, Ticket[]>,
): string {
	if (isEpic(ticket)) {
		return ticket.title;
	}
	const parent = parentOf(ticket, byKey);
	if (parent !== undefined && isEpic(parent) && parent !== root) {
		return parent.title;
	}
	if (isEpic(root) && root === ticket) {
		return root.title;
	}
	const belowRoot = [...ancestors(ticket, byKey)].find(
		(ancestor) => ancestor !== root,
	);
	if (isEpic(root) && belowRoot !== undefined) {
		return belowRoot.title;
	}
	if (isEpic(root)) {
		return scopeOf(ticket.title);
	}
	if (root !== ticket && root.key !== null) {
		return root.title;
	}
	if (ticket.key !== null && parents.has(foldKey(ticket.key))) {
		return ticket.title;
	}
	return scopeOf(ticket.title);
}

function linearMilestone(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): string | null {
	if (ticket.milestone !== null) {
		return ticket.milestone;
	}
	for (const parent of ancestors(ticket, byKey)) {
		if (parent.milestone !== null) {
			return parent.milestone;
		}
	}
	return null;
}

type Workstream = { label: string; key: string };

const noWorkstreamGroup: Workstream = {
	label: noWorkstream,
	key: noWorkstream,
};

function ownWorkstream(
	ticket: Ticket,
	root: Ticket,
	tracker: ProjectCounts["tracker"],
	byKey: Map<string, Ticket>,
): Workstream | undefined {
	if (tracker === "linear") {
		const milestone = linearMilestone(ticket, byKey);
		return milestone === null
			? undefined
			: { label: milestone, key: milestone };
	}
	if (isEpic(root)) {
		const key = root.key ?? root.title;
		return { label: root.title, key };
	}
	if (ticket.milestone !== null) {
		return { label: ticket.milestone, key: ticket.milestone };
	}
	return undefined;
}

function mostCommon(workstreams: Workstream[]): Workstream | undefined {
	const counts = new Map<string, { workstream: Workstream; count: number }>();
	for (const workstream of workstreams) {
		const known = counts.get(workstream.key);
		counts.set(workstream.key, {
			workstream,
			count: (known?.count ?? 0) + 1,
		});
	}
	let best: { workstream: Workstream; count: number } | undefined;
	for (const entry of counts.values()) {
		if (best === undefined || entry.count > best.count) {
			best = entry;
		}
	}
	return best?.workstream;
}

export type GroupKey = Exclude<GroupBy, "none">;

type GroupedTicket = {
	key: string | null;
	title: string;
	workstream?: string;
	workstreamKey?: string;
	themeGroup?: string;
	assignees?: string[];
};

function themeGroupOf(workstream: string, theme: string): string {
	return workstream === theme ? theme : `${workstream} / ${theme}`;
}

export function groupKeysOf(view: GroupedTicket, key: GroupKey): string[] {
	return groupBandsOf(view, key).map((band) => band.key);
}

export function groupLabelOf(
	view: GroupedTicket,
	key: GroupKey,
	band: string,
): string {
	return (
		groupBandsOf(view, key).find((item) => item.key === band)?.label ?? band
	);
}

function groupBandsOf(
	view: GroupedTicket,
	key: GroupKey,
): { key: string; label: string }[] {
	if (key === "assignee") {
		const names = [
			...new Set(
				(view.assignees ?? []).flatMap((name) => {
					const trimmed = name.trim();
					return trimmed === "" ? [] : [trimmed];
				}),
			),
		];
		const bands = names.length === 0 ? [noAssignee] : names;
		return bands.map((name) => ({ key: name, label: name }));
	}
	if (key === "workstream") {
		const label = view.workstream ?? noWorkstream;
		return [{ key: view.workstreamKey ?? label, label }];
	}
	const label = view.themeGroup ?? themeGroupOf(noWorkstream, noScope);
	return [{ key: label, label }];
}

export function ticketGroups<T extends GroupedTicket>(
	tickets: readonly T[],
	key: GroupBy,
): { name: string; label: string; tickets: T[] }[] {
	if (key === "none") {
		return [{ name: "", label: "", tickets: [...tickets] }];
	}
	const order: string[] = [];
	const labels = new Map<string, string>();
	const members = new Map<string, T[]>();
	for (const ticket of tickets) {
		for (const band of groupBandsOf(ticket, key)) {
			const known = members.get(band.key);
			if (known === undefined) {
				order.push(band.key);
				labels.set(band.key, band.label);
				members.set(band.key, [ticket]);
				continue;
			}
			known.push(ticket);
		}
	}
	return order
		.sort((left, right) =>
			(labels.get(left) ?? left).localeCompare(labels.get(right) ?? right),
		)
		.flatMap((name) => {
			const grouped = members.get(name);
			return grouped === undefined
				? []
				: [{ name, label: labels.get(name) ?? name, tickets: grouped }];
		});
}

function placeTickets(
	tickets: Ticket[],
	views: TicketView[],
	tracker: ProjectCounts["tracker"],
): Placed[] {
	const byKey = new Map<string, Ticket>();
	for (const ticket of tickets) {
		if (ticket.key !== null) {
			byKey.set(foldKey(ticket.key), ticket);
		}
	}
	const parents = new Map<string, Ticket[]>();
	for (const ticket of tickets) {
		const parent = parentOf(ticket, byKey);
		if (parent?.key !== null && parent?.key !== undefined) {
			const key = foldKey(parent.key);
			const known = parents.get(key);
			if (known === undefined) {
				parents.set(key, [ticket]);
			} else {
				known.push(ticket);
			}
		}
	}
	const owned = new Map(
		tickets.map((ticket) => [
			ticket,
			ownWorkstream(ticket, rootOf(ticket, byKey), tracker, byKey),
		]),
	);
	const subTicketsOf = (ticket: Ticket): Ticket[] =>
		ticket.key === null ? [] : (parents.get(foldKey(ticket.key)) ?? []);
	const treeWorkstream = (root: Ticket): Workstream | undefined => {
		const seen = new Set<Ticket>([root]);
		const pending = [root];
		for (
			let ticket = pending.pop();
			ticket !== undefined;
			ticket = pending.pop()
		) {
			for (const sub of subTicketsOf(ticket)) {
				if (!seen.has(sub)) {
					seen.add(sub);
					pending.push(sub);
				}
			}
		}
		return mostCommon(
			tickets.flatMap((ticket) =>
				seen.has(ticket) ? (owned.get(ticket) ?? []) : [],
			),
		);
	};
	const rootWorkstreams = new Map<Ticket, Workstream>();
	const rootWorkstream = (root: Ticket): Workstream => {
		const known = rootWorkstreams.get(root);
		if (known !== undefined) {
			return known;
		}
		const workstream =
			treeWorkstream(root) ??
			(tracker === "github" &&
			root.key !== null &&
			subTicketsOf(root).length > 0
				? { label: root.title, key: root.key }
				: noWorkstreamGroup);
		rootWorkstreams.set(root, workstream);
		return workstream;
	};
	// A ticket with no workstream of its own shares the workstream of its top
	// parent, so one tree of tickets stays in one group.
	const workstreamOf = (ticket: Ticket): Workstream =>
		owned.get(ticket) ?? rootWorkstream(rootOf(ticket, byKey));
	return tickets.flatMap((ticket, index) => {
		const view = views[index];
		if (view === undefined) {
			return [];
		}
		const root = rootOf(ticket, byKey);
		const workstream = workstreamOf(ticket);
		const theme = themeOf(ticket, root, byKey, parents);
		return [
			{
				ticket,
				view,
				workstream: workstream.label,
				workstreamKey: workstream.key,
				theme,
				themeGroup: themeGroupOf(workstream.label, theme),
			},
		];
	});
}

/** The chip that names a parent ticket: an outside parent, else a ticket of the project. */
export function parentChip(
	outsideParents: OutsideParent[],
	key: string,
): { label: string; outside?: OutsideParent } {
	const outside = outsideParents.find((parent) =>
		sameTicketKey(parent.key, key),
	);
	if (outside !== undefined) {
		return { label: outsideKey(outside.project, outside.key), outside };
	}
	return { label: shortKey(key) };
}

function summaryLine(counts: ProjectBody): string {
	return `${counts.name}: ${counts.done} done, ${counts.dropped} dropped, ${counts.blocked} blocked, ${counts.inProgress} in progress, ${counts.backlog} backlog.`;
}

export function projectReport(
	counts: ProjectBody,
	tickets: Ticket[],
	lanes: Lane[],
	relationsByKey: Map<string, ReturnType<typeof ticketRelations>> = new Map(),
	pullByKey: Map<string, PullRequest> = new Map(),
	needs: NeedsYouItem[] = [],
	runByKey: Map<string, LiveRun> = new Map(),
	outsideParents: OutsideParent[] = [],
): ProjectReport {
	const placed = placeTickets(tickets, counts.tickets, counts.tracker);
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
		...counts.unlinkedPrs.map((pull) => ({
			key: pullKey(pull),
			title: pull.title,
			state: "inProgress" as const,
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
			needsYou: needs,
		},
		{ id: "backlog", title: "Backlog", items: backlog },
	];
	const needsKeys = new Set(needs.map((item) => foldKey(item.key)));
	const placedByKey = new Map(
		placed.flatMap((item) =>
			item.ticket.key === null
				? []
				: [[foldKey(item.ticket.key), item] as const],
		),
	);
	const boardTickets = counts.tickets.map((view) => {
		const relations =
			view.key === null ? undefined : relationsByKey.get(foldKey(view.key));
		const pull =
			view.key === null ? undefined : pullByKey.get(foldKey(view.key));
		const commentRun =
			view.key === null ? undefined : runByKey.get(foldKey(view.key));
		const placedItem =
			view.key === null ? undefined : placedByKey.get(foldKey(view.key));
		return {
			...view,
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
			...(pull === undefined ? {} : { pull: pullKey(pull), pullUrl: pull.url }),
			...(view.key !== null && needsKeys.has(foldKey(view.key))
				? { needsYou: true as const }
				: {}),
		};
	});
	const doneTickets = boardTickets.filter(
		(ticket) => ticket.statusType === "done",
	);
	const graph = shownGraph(
		counts.name,
		counts.tracker,
		boardTickets,
		relationsByKey,
	);
	return {
		name: counts.name,
		tracker: counts.tracker,
		lanes,
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

const dayMs = 24 * 60 * 60 * 1000;

export function projectViewFor(
	configuration: Configuration,
	name: string,
): ProjectViewSettings {
	return savedProjectView(configuration.projectViews, name);
}

function ageDays(entered: string | undefined, now: Date): number {
	const at = Date.parse(entered ?? "");
	if (Number.isNaN(at)) {
		return 0;
	}
	return (now.getTime() - at) / dayMs;
}

function matchesProjectView(
	item: TicketView,
	view: ProjectViewSettings,
	shown: Set<string>,
	wanted: Set<string>,
	needle: string,
	now: Date,
	applyAge: boolean,
): boolean {
	const lane = (item.lane ?? "").toLowerCase();
	if (!shown.has(lane)) {
		return false;
	}
	const names = (item.assignees ?? []).map((name) => name.toLowerCase());
	if (wanted.size > 0 && !names.some((name) => wanted.has(name))) {
		return false;
	}
	if (view.needsYouOnly && item.needsYou !== true) {
		return false;
	}
	if (view.blockedOnly && item.blocked !== true) {
		return false;
	}
	if (applyAge) {
		const cap = laneAgeCap(view.maxAgeDays, item.lane ?? "", item.statusType);
		if (cap > 0 && ageDays(item.enteredStateAt, now) > cap) {
			return false;
		}
	}
	if (needle === "") {
		return true;
	}
	const key = foldKey(item.key) ?? "";
	return key.includes(needle) || item.title.toLowerCase().includes(needle);
}

export function attachGraphStates(reports: ProjectReport[]): ProjectReport[] {
	const states = stateByKey(reports);
	return reports.map((report) => ({
		...report,
		graphLinks: withEndStates(report.graphLinks, states),
	}));
}

export function filterProjectReport(
	report: ProjectReport,
	view: ProjectViewSettings,
	now: Date,
): ProjectReport {
	const shown = new Set(
		visibleLaneNames(report.lanes, view.shownLanes).map((name) =>
			name.toLowerCase(),
		),
	);
	const wanted = new Set(
		view.assignees.flatMap((name) => {
			const trimmed = name.trim().toLowerCase();
			return trimmed === "" ? [] : [trimmed];
		}),
	);
	const needle = view.search.trim().toLowerCase();
	const kept = report.tickets.filter((item) =>
		matchesProjectView(item, view, shown, wanted, needle, now, true),
	);
	const done = report.doneTickets.filter((item) =>
		matchesProjectView(item, view, shown, wanted, needle, now, false),
	);
	const keptKeys = new Set(
		kept.flatMap((item) => (item.key === null ? [] : [foldKey(item.key)])),
	);
	const localKey = (end: { project: string; key: string }): string | null =>
		end.project.toLowerCase() === report.name.toLowerCase()
			? foldKey(end.key)
			: null;
	const graphLinks = report.graphLinks.filter((link) => {
		const from = localKey(link.from);
		const to = localKey(link.to);
		const fromShown = from === null || keptKeys.has(from);
		const toShown = to === null || keptKeys.has(to);
		return fromShown && toShown;
	});
	const graphTickets = report.graphTickets.filter((ticket) => {
		const key = foldKey(ticket.key);
		return key !== undefined && keptKeys.has(key);
	});
	const hiddenBy = kept.length === 0 ? hidingFilters(report, view, shown) : [];
	return {
		...report,
		tickets: kept,
		doneTickets: done,
		graphTickets,
		graphLinks,
		graphParents: graphParentsOf(graphTickets, report.tickets),
		...(hiddenBy.length === 0 ? {} : { hiddenBy }),
	};
}

function hidingFilters(
	report: ProjectReport,
	view: ProjectViewSettings,
	shown: Set<string>,
): HidingFilter[] {
	if (report.tickets.length === 0) {
		return [];
	}
	const open: HidingFilter[] = [];
	if (view.shownLanes !== undefined && shown.size < report.lanes.length) {
		open.push("lanes");
	}
	const aged = report.tickets.some((item) => {
		const cap = laneAgeCap(view.maxAgeDays, item.lane ?? "", item.statusType);
		return cap > 0;
	});
	if (aged) {
		open.push("maxAge");
	}
	if (view.needsYouOnly) {
		open.push("needsYouOnly");
	}
	if (view.blockedOnly) {
		open.push("blockedOnly");
	}
	if (view.assignees.some((name) => name.trim() !== "")) {
		open.push("assignees");
	}
	if (view.search.trim() !== "") {
		open.push("search");
	}
	return open;
}

export type SettingsProject = {
	name: string;
	key: string;
	tracker: "github" | "linear";
	source: "found" | "configured";
	tracked: boolean;
	pmBot: boolean;
	repos: string[];
	expectedBots: KnownBot[];
	repoBots: Record<string, KnownBot[]>;
	ref: ProjectPin;
};

export type SettingsSnapshot = Pick<
	Snapshot,
	"key" | "tracker" | "owner" | "number"
> & {
	pulls: Pick<
		PullRequest,
		"repo" | "merged" | "checks" | "comments" | "reviews" | "reactions"
	>[];
};

export type FocusLink = { from: string; to: string };

/** The focused ids plus every id upstream or downstream of them through the links. */
export function focusChain(
	seeds: ReadonlySet<string>,
	links: readonly FocusLink[],
): ReadonlySet<string> {
	const chain = new Set(seeds);
	const walk = (next: (id: string) => string[]) => {
		const queue = [...seeds];
		const seen = new Set(seeds);
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			for (const other of next(id)) {
				if (!seen.has(other)) {
					seen.add(other);
					chain.add(other);
					queue.push(other);
				}
			}
		}
	};
	walk((id) => links.filter((link) => link.to === id).map((link) => link.from));
	walk((id) => links.filter((link) => link.from === id).map((link) => link.to));
	return chain;
}
