import { z } from "zod";
import type {
	AutoMerge,
	Configuration,
	ProjectViewSettings,
} from "./configuration.ts";
import {
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

export type TicketState = StatusType;

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
	labels: string[];
	assignee?: string | null;
	assignees?: string[];
	status?: TicketStatus;
	emptyStatus?: boolean;
	history?: { statusId: string; at: string; statusType?: StatusType }[];
	closedAt?: string;
	createdAt?: string;
};

export type OutsideBlocker = {
	tracker: "github" | "linear";
	project: string;
	key: string;
	title: string;
};

export type TicketView = {
	key: string | null;
	title: string;
	state: TicketState;
	blockers: string[];
	outsideBlockers?: OutsideBlocker[];
	blocks?: OutsideBlocker[];
	lane?: string;
	statusType?: StatusType;
	blocked?: boolean;
	staleStatus?: string;
	chips?: string[];
	pull?: string;
	needsYou?: boolean;
	enteredStateAt?: string;
	run?: LiveRun;
	updatedAt?: string;
	assignees?: string[];
};

export type CrossProjectBlocker = {
	project: string;
	tracker: "github" | "linear";
	key: string;
	title: string;
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
	pinned: boolean;
	ref: Configuration["pinned"][number];
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
};

export type ProjectBody = Omit<ProjectCounts, "pinned" | "ref">;

export type DiagramNode = {
	id: string;
	label: string;
	state: TicketState | "external" | "theme";
	dashed: boolean;
	project: string;
	tracker: "github" | "linear";
	ticket: string | null;
};

export type DiagramEdge = {
	from: string;
	to: string;
};

export type Diagram = {
	id: string;
	title: string;
	direction: "TD" | "LR";
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	definition: string;
};

export type ThreadComment = {
	id: string;
	body: string;
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

export type ReplyRequest = {
	tracker: "github" | "linear";
	project: string;
	key: string;
	body: string;
	parentId?: string;
	kind?: "comment" | "review";
};

const htmlComment = /<!--[\s\S]*?-->/g;

function visibleCommentBody(body: string): string {
	return body
		.replace(htmlComment, "")
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

function visibleComment(comment: ThreadComment): ThreadComment {
	return { ...comment, body: visibleCommentBody(comment.body), children: [] };
}

export function commentTree(comments: ThreadComment[]): ThreadComment[] {
	const byParent = new Map<string | null, ThreadComment[]>();
	for (const comment of comments) {
		const parent = comment.parentId;
		const list = byParent.get(parent) ?? [];
		list.push(visibleComment(comment));
		byParent.set(parent, list);
	}
	const attach = (comment: ThreadComment): ThreadComment => ({
		...comment,
		children: (byParent.get(comment.id) ?? []).map(attach),
	});
	return (byParent.get(null) ?? []).map(attach);
}

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
		}
	>;
	blockers: Map<string, string>;
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
	const ticket = tickets.get(ticketKey(item.tracker, item.key));
	if (ticket !== undefined) {
		const linkedPulls = linked(ticket, pulls);
		return [...(ticket.comments ?? []), ...linkedPulls.flatMap(pullComments)];
	}
	const pull = pulls.find((candidate) => pullKey(candidate) === item.key);
	return pull === undefined ? [] : pullComments(pull);
}

function ticketKey(tracker: string, key: string): string {
	return `${tracker}\n${key.toLowerCase()}`;
}

export function attentionOf(
	views: {
		items: NeedsYouItem[];
		counts: ProjectCounts;
		row: Snapshot;
	}[],
	pmBot: Record<string, boolean> = {},
): Attention {
	const comments = new Map<
		string,
		{
			stamp: string;
			replyStamp: string;
			authors: string[];
			project: string;
		}
	>();
	const blockers = new Map<string, string>();
	const closed = new Set<string>();
	const closedBlockers = new Set<string>();
	const tickets = new Map<string, Ticket>();
	for (const view of views) {
		for (const ticket of view.row.tickets) {
			if (ticket.key === null) {
				continue;
			}
			const id = ticketKey(ticket.tracker, ticket.key);
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
					? levReply(itemComments, ask.index)
					: null;
			const newest = newestComment(itemComments);
			comments.set(`${item.project}\n${item.key}`, {
				stamp: newest.stamp,
				replyStamp: reply?.createdAt ?? "",
				authors: newest.authors,
				project: item.project,
			});
		}
		for (const blocker of view.counts.crossProjectBlockers) {
			blockers.set(
				`${view.counts.name}\n${blocker.tracker}\n${blocker.key}`,
				blocker.title.trim() === "" ? blocker.key : blocker.title,
			);
		}
		for (const ticket of view.row.tickets) {
			if (ticket.key === null) {
				continue;
			}
			for (const ref of ticket.blockedBy) {
				const id = ticketKey(ref.tracker, ref.key);
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

export function needsYouSeenId(item: { project: string; key: string }): string {
	return `needsYou\n${item.project}\n${item.key}`;
}

function needsYouNotificationId(item: NeedsYouItem, at: string): string {
	return `${needsYouSeenId(item)}\n${at}`;
}

export function attentionIds(attention: Attention): string[] {
	return [
		...attention.needsYou.map(needsYouSeenId),
		...[...attention.comments].map(
			([id, comment]) => `comment\n${id}\n${comment.stamp}`,
		),
	];
}

export function departedNeedsYouIds(
	before: Attention,
	after: Attention,
	loadedProjects: ReadonlySet<string>,
): string[] {
	const current = new Set(
		after.needsYou.map((item) => `${item.project}\n${item.key}`),
	);
	return before.needsYou.flatMap((item) =>
		!loadedProjects.has(item.project) ||
		current.has(`${item.project}\n${item.key}`)
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
			before.needsYou.map((item) => `${item.project}\n${item.key}`),
		);
		for (const item of after.needsYou) {
			const id = `${item.project}\n${item.key}`;
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
				(candidate) => `${candidate.project}\n${candidate.key}` === id,
			);
			const [project = "", itemKey = ""] = id.split("\n");
			push(
				"comment",
				`comment\n${id}\n${comment.stamp}`,
				project,
				itemKey,
				item?.headline ?? itemKey,
			);
		}
	}
	if (triggers.blockerCleared) {
		for (const [id, title] of before.blockers) {
			if (after.blockers.has(id)) {
				continue;
			}
			const [, tracker = "", itemKey = ""] = id.split("\n");
			const closedKey = `${tracker}\n${itemKey.toLowerCase()}`;
			if (
				!after.closed.has(closedKey) &&
				!after.closedBlockers.has(closedKey)
			) {
				continue;
			}
			const [project = ""] = id.split("\n");
			push(
				"blockerCleared",
				`blockerCleared\n${id}\n${at}`,
				project,
				itemKey,
				title,
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
			tracker: entry.key.includes("#") ? "github" : "linear",
		};
	});
}

export type ReportSection = {
	id:
		| "summary"
		| "featureMap"
		| "inFlight"
		| "blockingChains"
		| "needsYou"
		| "backlog";
	title: string;
	text?: string;
	items?: TicketView[];
	needsYou?: NeedsYouItem[];
	diagrams?: Diagram[];
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
};

export type Overview = {
	projects: ProjectCounts[];
	fetchedAt: string | null;
	error: string | null;
	polling?: true;
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
};

export type ProjectPoll = {
	key: string;
	ok: boolean;
	error: string | null;
	full: boolean;
	pinned: boolean;
	hidden: boolean;
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
				? `${namedRepo}#${namedNumber}`
				: bareNumber !== undefined
					? `${repo}#${bareNumber}`
					: team !== undefined && linearNumber !== undefined
						? `${team.toUpperCase()}-${linearNumber}`
						: null;
		if (key !== null && !keys.includes(key)) {
			keys.push(key);
		}
	}
	return keys;
}

function sameRef(left: TicketRef, right: TicketRef): boolean {
	return (
		left.tracker === right.tracker &&
		left.key.toLowerCase() === right.key.toLowerCase()
	);
}

function mergeBlockedBy(rows: TicketRef[][]): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const row of rows) {
		for (const ref of row) {
			if (!refs.some((item) => sameRef(item, ref))) {
				refs.push(ref);
			}
		}
	}
	return refs;
}

export function mergeTickets(stored: Ticket[], incoming: Ticket[]): Ticket[] {
	const byId = new Map(stored.map((ticket) => [ticket.id, ticket]));
	for (const ticket of incoming) {
		byId.set(ticket.id, ticket);
	}
	return [...byId.values()];
}

export type PollReconcile = {
	rows: Snapshot[];
	projectErrors: { key: string; error: string }[];
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
	const incomingIds = new Set(
		incoming.map((pull) => `${pull.repo}#${pull.number}`),
	);
	const incomingKeys = new Set(incoming.flatMap((pull) => pull.closingKeys));
	return [
		...incoming,
		...stored.filter(
			(pull) =>
				!incomingIds.has(`${pull.repo}#${pull.number}`) &&
				!pull.closingKeys.some(
					(key) => returnedIds.has(key) || incomingKeys.has(key),
				),
		),
	];
}

export function reconcilePoll(
	previous: Snapshot[],
	outcomes: ProjectPoll[],
	fullKeys: string[],
): PollReconcile {
	const full = new Set(fullKeys);
	const rows: Snapshot[] = [];
	const projectErrors: { key: string; error: string }[] = [];
	const seen = new Set<string>();
	for (const outcome of outcomes) {
		seen.add(outcome.key);
		if (outcome.ok) {
			if (outcome.row === null) {
				continue;
			}
			const prior = previous.find((row) => row.key === outcome.key);
			const tickets = outcome.full
				? outcome.row.tickets
				: mergeTickets(prior?.tickets ?? [], outcome.row.tickets);
			const returnedIds = new Set(
				outcome.row.tickets.flatMap((ticket) =>
					ticket.key === null ? [] : [ticket.key],
				),
			);
			rows.push({
				...outcome.row,
				tickets,
				pulls: keptPulls(
					prior?.pulls ?? [],
					outcome.row.pulls,
					returnedIds,
					outcome.full,
				),
			});
			continue;
		}
		if (outcome.error !== null) {
			projectErrors.push({ key: outcome.key, error: outcome.error });
		}
		const prior = previous.find((row) => row.key === outcome.key);
		if (prior !== undefined) {
			rows.push(prior);
			continue;
		}
		if (
			outcome.row === null ||
			outcome.error === null ||
			!showsFailedProject({
				pinned: outcome.pinned,
				hidden: outcome.hidden,
				hasStoredRows: false,
			})
		) {
			continue;
		}
		rows.push(outcome.row);
	}
	for (const row of previous) {
		if (seen.has(row.key) || full.size > 0) {
			continue;
		}
		rows.push(row);
	}
	const failed = outcomes.find(
		(outcome) =>
			!outcome.ok &&
			outcome.error !== null &&
			!outcome.hidden &&
			!rows.some((row) => row.key === outcome.key),
	);
	const globalError = failed?.error ?? null;
	return { rows, projectErrors, globalError };
}

const appColours: Record<StatusType, string> = {
	backlog: "#D0D7DE",
	inProgress: "#F0C674",
	inReview: "#9ECBFF",
	awaitingMerge: "#B7E1CD",
	done: "#8FBC8F",
	dropped: "#9CA3AF",
};

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

function appLane(statusType: StatusType): Lane {
	return {
		id: statusType,
		name: appLaneNames[statusType],
		colour: appColours[statusType],
		statusType,
	};
}

export function appLanes(): Lane[] {
	return statusTypeOrder.map(appLane);
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

export const backlogColour = appColours.backlog;

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

function insertAwaitingMerge(lanes: Lane[]): Lane[] {
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
		colour: appColours.awaitingMerge,
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
): Lane[] {
	if (!trackerLanes(board) || board === undefined) {
		return appLanes();
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
	return insertAwaitingMerge(lanes);
}

export function laneForTicket(ticket: Ticket, lanes: Lane[]): Lane {
	if (ticket.emptyStatus === true) {
		return laneOfType(lanes, closedLaneType(ticket) ?? "backlog");
	}
	const matched =
		ticket.status === undefined ? undefined : laneOfStatus(ticket, lanes);
	const closedType = closedLaneType(ticket);
	if (closedType !== undefined) {
		if (matched?.statusType === closedType) {
			return matched;
		}
		return laneOfType(lanes, closedType);
	}
	if (matched !== undefined) {
		return matched;
	}
	if (ticket.status === undefined) {
		return laneOfType(lanes, "backlog");
	}
	return laneOfType(lanes, ticket.status.statusType);
}

function laneOfType(lanes: Lane[], statusType: StatusType): Lane {
	return (
		lanes.find((lane) => lane.statusType === statusType) ?? appLane(statusType)
	);
}

function placeOnBoard(lanes: Lane[], tickets: Ticket[]): Lane[] {
	const placed = [...lanes];
	for (const ticket of tickets) {
		const statusType = laneForTicket(ticket, placed).statusType;
		if (placed.some((lane) => lane.statusType === statusType)) {
			continue;
		}
		placed.splice(laneInsertAt(placed, statusType), 0, {
			...appLane(statusType),
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
	return closedReasons.has(ticket.stateReason ?? "") ? "dropped" : "done";
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

function refFrom(match: RegExpExecArray, project: string): TicketRef | null {
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
			key: `${repo}#${githubUrlNumber}`,
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
			key: `${ownerRepo}#${ownerNumber}`,
		};
	}
	const sameNumber = match[7];
	if (sameNumber !== undefined) {
		if (!project.includes("/")) {
			return null;
		}
		return { tracker: "github", project, key: `${project}#${sameNumber}` };
	}
	const linearKey = match[8];
	if (linearKey !== undefined) {
		return { tracker: "linear", project: "", key: linearKey.toUpperCase() };
	}
	return null;
}

function parseLine(
	line: string,
	project: string,
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
		const ref = refFrom(found, project);
		if (ref !== null && !refs.some((item) => sameRef(item, ref))) {
			refs.push(ref);
		}
	}
	return refs;
}

export function bodyBlockers(
	ticket: Ticket,
	project: string,
	direction: "blockedBy" | "blocks",
): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const line of ticket.body.split("\n")) {
		for (const ref of parseLine(line, project, direction)) {
			if (!refs.some((item) => sameRef(item, ref))) {
				refs.push(ref);
			}
		}
	}
	return refs;
}

type TicketIndex = Map<string, Ticket>;

function indexKey(tracker: string, key: string): string {
	return `${tracker}\0${key.toLowerCase()}`;
}

export function sameTicketKey(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

function indexTickets(tickets: Ticket[]): TicketIndex {
	const index = new Map<string, Ticket>();
	for (const ticket of tickets) {
		if (ticket.key === null) {
			continue;
		}
		const key = indexKey(ticket.tracker, ticket.key);
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
	return index.get(indexKey(ref.tracker, ref.key));
}

function stillOpen(ref: TicketRef, index: TicketIndex): boolean {
	const ticket = known(index, ref);
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
	return indexKey(ticket.tracker, ticket.key ?? "");
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

function bodyProject(ticket: Ticket, project: string): string {
	if (project.includes("/")) {
		return project;
	}
	const repo = ticket.key?.split("#")[0];
	if (ticket.tracker === "github" && repo?.includes("/") === true) {
		return repo;
	}
	return project;
}

function parseBodies(
	groups: { project: string; tickets: Ticket[] }[],
): ParsedBodies {
	const parsed: ParsedBodies = new Map();
	for (const group of groups) {
		for (const ticket of group.tickets) {
			const key = parseKey(ticket);
			const project = bodyProject(ticket, group.project);
			const blockedBy = bodyBlockers(ticket, project, "blockedBy");
			const blocks = bodyBlockers(ticket, project, "blocks");
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
					item.key?.toLowerCase() === blocker.key?.toLowerCase(),
			) === position
		);
	});
}

export function showsFailedProject(input: {
	pinned: boolean;
	hidden: boolean;
	hasStoredRows: boolean;
}): boolean {
	if (input.hidden || input.hasStoredRows) {
		return false;
	}
	return input.pinned;
}

export function showsProject(input: {
	pinned: boolean;
	hidden: boolean;
	openTickets: number;
	updatedAt: string | null;
	now: Date;
	activityWindowDays: number;
}): boolean {
	if (input.hidden) {
		return false;
	}
	if (input.pinned) {
		return true;
	}
	if (input.openTickets === 0 || input.updatedAt === null) {
		return false;
	}
	const updated = Date.parse(input.updatedAt);
	const windowMs = input.activityWindowDays * 24 * 60 * 60 * 1000;
	return updated >= input.now.getTime() - windowMs;
}

export type ListedProject = {
	key: string;
	name?: string;
	tracker: "github" | "linear";
	updatedAt: string | null;
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
	board?: Board;
	pinned: boolean;
	hidden: boolean;
	closed?: boolean;
	windowTickets?: Ticket[];
};

export function projectSnapshots(
	found: ListedProject[],
	now: Date,
	activityWindowDays: number,
): {
	key: string;
	name: string;
	tracker: ListedProject["tracker"];
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
	board?: Board;
}[] {
	const projects = [
		...found.filter(
			(project) => project.tracker === "github" && !project.key.includes("/"),
		),
		...found.filter(
			(project) => project.tracker === "linear" || project.key.includes("/"),
		),
	];
	const shown = projects.filter((project) => {
		const windowTickets = project.windowTickets ?? project.tickets;
		const openTickets = windowTickets.filter(
			(ticket) => ticket.state === "open",
		).length;
		const ticketUpdated = windowTickets.reduce<string | null>(
			(latest, ticket) => {
				if (ticket.updatedAt === undefined) {
					return latest;
				}
				return latest === null || ticket.updatedAt > latest
					? ticket.updatedAt
					: latest;
			},
			null,
		);
		const updatedAt =
			project.updatedAt === null
				? ticketUpdated
				: ticketUpdated === null || project.updatedAt > ticketUpdated
					? project.updatedAt
					: ticketUpdated;
		return (
			project.closed !== true &&
			showsProject({
				pinned: project.pinned,
				hidden: project.hidden,
				openTickets,
				updatedAt,
				now,
				activityWindowDays,
			})
		);
	});
	const carried = new Map<string, Ticket>();
	for (const project of shown) {
		if (!project.key.includes("/")) {
			continue;
		}
		for (const ticket of project.tickets) {
			if (ticket.ref !== undefined) {
				carried.set(ticket.ref, ticket);
			}
		}
	}
	const claimed = new Set<string>();
	const rows = [];
	for (const project of shown) {
		const tickets = project.tickets.flatMap((ticket) => {
			if (ticket.ref !== undefined && claimed.has(ticket.ref)) {
				return [];
			}
			const donor =
				ticket.ref === undefined ? undefined : carried.get(ticket.ref);
			const outgoing = bodyLines(donor, ticket);
			const kept =
				donor === undefined || donor === ticket
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
								bodyBlockers(
									donor,
									bodyProject(donor, project.key),
									"blockedBy",
								),
								bodyBlockers(
									ticket,
									bodyProject(ticket, project.key),
									"blockedBy",
								),
							]),
						};
			if (ticket.ref !== undefined) {
				claimed.add(ticket.ref);
			}
			return [kept];
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
		});
	}
	return rows;
}

function ticketNumber(key: string): string | null {
	const number = key.split("#").at(-1);
	if (number === undefined || !/^\d+$/.test(number)) {
		return null;
	}
	return number;
}

export const ownerRepo = /^[^/\s]+\/[^/\s]+$/;
const githubNode = /^(\d+)-/;
const sessionSuffix = /\.[a-z][a-z0-9]*-\d+$/i;
const linearKey = /^([a-z][a-z0-9]*)-(\d+)(?![a-z0-9])/i;

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
			const match = segment.match(linearKey);
			const team = match?.[1];
			const number = match?.[2];
			if (team === undefined || number === undefined) {
				continue;
			}
			const key = `${team.toUpperCase()}-${number}`;
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
		const scoped = key.startsWith("#") ? `${repo ?? project}${key}` : key;
		if (!keys.some((item) => item.toLowerCase() === scoped.toLowerCase())) {
			keys.push(scoped);
		}
	}
	return keys;
}

function branchLinksTicket(branch: string, key: string): boolean {
	const number = ticketNumber(key);
	const leading = branch.match(/^(?:[^/]+\/)?(\d+)-/)?.[1];
	if (leading !== undefined) {
		return number !== null && leading === number;
	}
	return key.includes("#") && branch.toLowerCase().includes(key.toLowerCase());
}

function linked(ticket: Ticket, pulls: PullRequest[]): PullRequest[] {
	if (ticket.key === null) {
		return [];
	}
	const key = ticket.key;
	return pulls.filter((pull) => {
		const keys = [...pull.closingKeys, ...closingKeys(pull.body, pull.repo)];
		return keys.includes(key) || branchLinksTicket(pull.branch, key);
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
	if (blocker.tracker === "github" && blocker.key?.includes("#") === true) {
		return blocker.key.split("#")[0] ?? "";
	}
	return "";
}

function outsideOf(
	blocker: Ticket,
	ref: TicketRef | undefined,
	groups: { project: string; tickets: Ticket[] }[],
): OutsideBlocker | null {
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

function ticketRelations(
	ticket: Ticket,
	blockers: Ticket[],
	index: TicketIndex,
	parsed: ParsedBodies,
	groups: { project: string; tickets: Ticket[] }[],
): {
	blockers: string[];
	outsideBlockers: OutsideBlocker[];
	blocks: OutsideBlocker[];
} {
	const self = asRef(ticket);
	const home = groups.find((group) => group.tickets.includes(ticket))?.project;
	const merged = self === null ? undefined : known(index, self);
	const incoming = [
		...(merged?.blockedBy ?? ticket.blockedBy),
		...(parsed.get(parseKey(ticket))?.blockedBy ?? []),
	];
	const keys: string[] = [];
	const outsideBlockers: OutsideBlocker[] = [];
	for (const blocker of blockers) {
		if (blocker.key === null) {
			continue;
		}
		keys.push(blocker.key);
		const source = incoming.find(
			(ref) =>
				ref.tracker === blocker.tracker &&
				ref.key.toLowerCase() === blocker.key?.toLowerCase(),
		);
		const project = blockerProject(blocker, source, groups);
		if (
			project === "" ||
			home === undefined ||
			project.toLowerCase() === home.toLowerCase()
		) {
			continue;
		}
		const outside = outsideOf(blocker, source, groups);
		if (outside !== null) {
			outsideBlockers.push(outside);
		}
	}
	const blocks: OutsideBlocker[] = [];
	const ownBlocks = mergeBlockedBy([
		parsed.get(parseKey(ticket))?.blocks ?? [],
		merged?.blocks ?? ticket.blocks ?? [],
	]);
	if (self !== null && ticket.state === "open") {
		for (const ref of ownBlocks) {
			if (!stillOpen(ref, index)) {
				continue;
			}
			const other = known(index, ref);
			const otherHome =
				other === undefined
					? undefined
					: groups.find((group) => group.tickets.includes(other))?.project;
			const project = otherHome ?? ref.project;
			if (
				project === "" ||
				home === undefined ||
				project.toLowerCase() === home.toLowerCase() ||
				blocks.some((item) => sameRef(item, ref))
			) {
				continue;
			}
			const title = other?.title.trim() || ref.title?.trim() || ref.key;
			blocks.push({
				tracker: ref.tracker,
				project,
				key: ref.key,
				title: title || ref.key,
			});
		}
		for (const group of groups) {
			if (group.project.toLowerCase() === home?.toLowerCase()) {
				continue;
			}
			for (const other of group.tickets) {
				if (
					other.state !== "open" ||
					other.key === null ||
					blocks.some((item) => sameRef(item, asRef(other) ?? self))
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
				blocks.push({
					tracker: other.tracker,
					project: group.project,
					key: other.key,
					title: other.title.trim() || other.key,
				});
			}
		}
	}
	return { blockers: keys, outsideBlockers, blocks };
}

export const knownBots = ["grok", "codex", "greptile"] as const;
export type KnownBot = (typeof knownBots)[number];

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

function expectedBotsFromHistory(pulls: PullRequest[]): KnownBot[] {
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
	pulls: PullRequest[],
	overrides: Record<string, KnownBot[]>,
): Map<string, KnownBot[]> {
	const repos = new Set(pulls.map((pull) => pull.repo));
	const bots = new Map<string, KnownBot[]>();
	for (const repo of repos) {
		bots.set(
			repo,
			expectedBotsFromHistory(pulls.filter((pull) => pull.repo === repo)),
		);
	}
	for (const [repo, override] of Object.entries(overrides)) {
		if (bots.has(repo)) {
			bots.set(repo, override);
		}
	}
	return bots;
}

function pullShowsBot(pull: PullRequest, bot: KnownBot): boolean {
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

const progressHeading = "**Workcell progress**";
const stageLine = /^stage\s+(\d+)\b/i;
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
				(reportAsk !== null && askAnsweredLine(line, reportAsk)),
		);
}

function progressRun(comments: Comment[]): LiveRun | undefined {
	const found = progressComment(comments);
	if (found === undefined) {
		return undefined;
	}
	const { lines, reportAt } = found;
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
	return { status: "running", stage };
}

function workcellRun(
	comments: Comment[],
	pull: PullRequest,
): { state: "inReview" | "awaitingMerge"; tags: string[] } | null {
	const found = progressComment(comments);
	if (found === undefined) {
		return null;
	}
	const { progress, lines, later, reportAt, report } = found;
	const reportAsk = report === undefined ? null : askId(report.body);
	if (reportAt >= 0 || report !== undefined) {
		if (
			resumedAfterReport(
				found,
				(line) => stageLine.test(line) && !namesAnotherPull(line, pull),
			)
		) {
			return { state: "inReview", tags: [] };
		}
		const marker =
			report !== undefined && commentNamesPull(report.body, pull.number);
		if (marker && reportAsk === null) {
			return { state: "awaitingMerge", tags: [] };
		}
		if (marker && reportAsk !== null) {
			const after = later.slice(later.indexOf(report) + 1);
			if (!askAnswered([progress, ...after], reportAsk)) {
				return { state: "awaitingMerge", tags: [] };
			}
			return { state: "inReview", tags: [] };
		}
		if (reportAt >= 0 && lineDecidesPull(lines[reportAt] ?? "", pull, lines)) {
			return { state: "awaitingMerge", tags: [] };
		}
	}
	const mergeAsk = openMergeAsk(later, pull.number);
	if (
		mergeAsk !== null &&
		!askAnswered([progress, ...later.slice(mergeAsk.index + 1)], mergeAsk.id)
	) {
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

function openMergeAsk(
	later: Comment[],
	number: number,
): { id: string; index: number } | null {
	let found: { id: string; index: number } | null = null;
	for (const [index, comment] of later.entries()) {
		const marker = askId(comment.body);
		if (marker === null || !commentNamesPull(comment.body, number)) {
			continue;
		}
		const first = comment.body.split("\n")[0]?.trim() ?? "";
		if (
			first.match(mergeAskLine)?.[1] === String(number) ||
			comment.body.includes(reportMarker) ||
			finalReportLine.test(first)
		) {
			found = { id: marker, index };
		}
	}
	return found;
}

function askAnswered(later: Comment[], id: string): boolean {
	return later.some(
		(comment) =>
			quotesAsk(comment.body, id) ||
			answerPrefix.test(comment.body.trim()) ||
			progressAnswered(comment.body, id),
	);
}

function askAnsweredLine(line: string, id: string): boolean {
	const askNumber = id.split("-").at(-1);
	if (askNumber === undefined) {
		return false;
	}
	return new RegExp(`^ask-${askNumber}\\s+answered\\b`, "i").test(line);
}

function progressAnswered(body: string, id: string): boolean {
	if (!body.trimStart().startsWith(progressHeading)) {
		return false;
	}
	return body
		.split("\n")
		.some((line) => askAnsweredLine(line.trim().replace(/^-\s*/, ""), id));
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
		if (run.key.toLowerCase() === key.toLowerCase()) {
			return true;
		}
		if (run.repo === undefined) {
			return false;
		}
		return `${run.repo}#${run.key}`.toLowerCase() === key.toLowerCase();
	});
}

function closesTicket(pull: PullRequest, ticket: Ticket): boolean {
	const key = ticket.key;
	if (key === null || !pull.merged) {
		return false;
	}
	return closingKeys(pull.body, pull.repo).some(
		(item) => item.toLowerCase() === key.toLowerCase(),
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
): ShownTicket {
	const trackerState = lane.statusType;
	let state = trackerState;
	const key = ticket.key;
	const started =
		key !== null &&
		startedKeys.some((item) => item.toLowerCase() === key.toLowerCase());
	const pushed =
		key !== null && branches.some((branch) => branchLinksTicket(branch, key));
	const draft = links.some((pull) => pull.draft);
	const local = runFor(ticket, runs);
	const fromComment = progressRun(ticket.comments ?? []);
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
		blocked: ticket.state === "open" && ticket.blockedBy.length > 0,
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

function pullKey(pull: PullRequest): string {
	return `${pull.repo}#${pull.number}`;
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
	all: { project: string; tickets: Ticket[] }[],
	expectedBots: Map<string, KnownBot[]>,
	status: FetchStatus,
	rules: Omit<NeedsYouRules, "pmBot"> & {
		pmBot: Record<string, boolean>;
	},
	laneMappings: Configuration["laneMappings"],
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
	const lanes = placeOnBoard(lanesFor(board, mapping), tickets);
	const tags = new Set<string>();
	const views: TicketView[] = [];
	const relationsByKey = new Map<string, ReturnType<typeof ticketRelations>>();
	const pullByKey = new Map<string, string>();
	const shownByKey = new Map<string, TicketState>();
	const failedKeys = new Set<string>();
	const runByKey = new Map<string, LiveRun>();
	const cross = new Map<string, CrossProjectBlocker>();
	const active = pulls.filter((pull) => !pull.merged);
	const linkedByTicket = new Map<string, PullRequest[]>();
	const linkedKeys = new Set<string>();
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
		const lane = laneForTicket(ticket, lanes);
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
		);
		if (ticket.key !== null) {
			shownByKey.set(ticket.key, shown.state);
			if (shown.runFailed) {
				failedKeys.add(ticket.key);
			}
			if (shown.run !== undefined) {
				runByKey.set(ticket.key.toLowerCase(), shown.run);
			}
		}
		if (blockers.length > 0 && ticket.state === "open") {
			counts.blocked += 1;
		} else {
			counts[shown.state] += 1;
		}
		statusTypes[shown.lane.statusType] += 1;
		if (ticket.key !== null) {
			relationsByKey.set(
				ticket.key.toLowerCase(),
				ticketRelations(ticket, blockers, index, parsed, all),
			);
			const pull = links[0];
			if (pull !== undefined) {
				pullByKey.set(ticket.key.toLowerCase(), pullKey(pull));
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
					ref.key.toLowerCase() === blocker.key?.toLowerCase(),
			);
			const project = blockerProject(blocker, source, all);
			if (project === "" || project.toLowerCase() === name.toLowerCase()) {
				continue;
			}
			cross.set(`${blocker.tracker} ${project} ${blocker.key}`, {
				project,
				tracker: blocker.tracker,
				key: blocker.key,
				title: blocker.title,
			});
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
		tickets: views,
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
	);
	return {
		counts: project,
		needsYou: needsYouItemsForProject,
		report,
	};
}

const stateKeys = [
	"done",
	"dropped",
	"blocked",
	"backlog",
	"inProgress",
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

const askMarker = /<!--\s*workcell:ask\s+([A-Za-z0-9_.-]+)\s*-->/i;
const workcellMarker = /<!--\s*workcell:/i;
const answerPrefix = /^(?:senior|reply|answer)\b/i;
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

function askId(body: string): string | null {
	return body.match(askMarker)?.[1] ?? null;
}

function quotesAsk(body: string, id: string): boolean {
	const pattern = new RegExp(
		`(?<![A-Za-z0-9_.-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_.-])`,
		"i",
	);
	return pattern.test(body);
}

const numberedOption = /^(\d+)[.)]\s+(\S.*)$/;

function askOptions(body: string): AskOption[] {
	const text = body.replace(askMarker, "");
	const options: AskOption[] = [];
	for (const line of text.split("\n")) {
		const match = line.trim().match(numberedOption);
		const number = match?.[1];
		const label = match?.[2]?.trim();
		if (number === undefined || label === undefined || label === "") {
			continue;
		}
		options.push({ number: Number(number), label });
	}
	return options;
}

function askQuestion(body: string, headline: string): string {
	const lines = body
		.replace(askMarker, "")
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) =>
				line !== "" && !line.startsWith("<!--") && !numberedOption.test(line),
		);
	const asked = lines.find((line) => line.endsWith("?"));
	if (asked !== undefined) {
		return asked;
	}
	return lines.at(-1) ?? headline;
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
		ci: ciOf(pull),
		review: reviewOf(pull),
	};
}

function askHeadline(body: string): string {
	const text = body.replace(askMarker, "").trim();
	const named = text
		.split(/(?<=[.!?])\s+|\n+/)
		.map((part) => part.trim())
		.find((part) => namesLev(part));
	if (named !== undefined) {
		return named.replace(/^senior,\s*/i, "");
	}
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("<!--"));
	return lines.at(-1) ?? text;
}

function quotesAskText(body: string, askBody: string): boolean {
	const headline = askHeadline(askBody);
	const text = askBody.replace(askMarker, "").trim();
	if (headline === "" && text === "") {
		return false;
	}
	return body.split("\n").some((line) => {
		const quoted = line.trimStart();
		if (!quoted.startsWith(">")) {
			return false;
		}
		const content = quoted.slice(1).trim();
		return (
			(headline !== "" && content === headline) ||
			(text !== "" && content.includes(text))
		);
	});
}

function commentTime(comment: Comment): number {
	if (comment.createdAt === undefined) {
		return 0;
	}
	const parsed = Date.parse(comment.createdAt);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function orderedComments(comments: Comment[]): Comment[] {
	return comments.every((comment) => comment.createdAt === undefined)
		? comments
		: [...comments].sort(
				(left, right) => commentTime(left) - commentTime(right),
			);
}

function namesLev(body: string): boolean {
	return /\blev\b/i.test(body);
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

function progressPicked(body: string, id: string): boolean {
	if (!body.trimStart().startsWith(progressHeading)) {
		return false;
	}
	const line = body
		.split("\n")
		.find((item) => item.replace(/^\s*-?\s*/, "").startsWith(`ask-${id}:`));
	return line !== undefined && /human picks\b/i.test(line);
}

function askClosed(later: Comment[], id: string): boolean {
	return later.some(
		(item) => quotesAsk(item.body, id) || progressPicked(item.body, id),
	);
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
	const comments = ticket?.comments ?? [];
	const ask = openAsk(comments, pmBot);
	if (ask === null) {
		return text;
	}
	const source = orderedComments(comments)[ask.index];
	if (source === undefined || levReply(comments, ask.index) !== null) {
		return text;
	}
	if (parentId !== undefined && parentId !== source.id) {
		return text;
	}
	const headline = askHeadline(source.body);
	if (headline === "") {
		return text;
	}
	return `> ${headline}\n\n${text}`;
}

type OpenAsk = {
	headline: string;
	question: string;
	options: AskOption[];
	tags: string[];
	index: number;
};

function openAsk(comments: Comment[], pmBot: boolean): OpenAsk | null {
	const ordered = orderedComments(comments);
	const latest = new Map<string, number>();
	ordered.forEach((comment, index) => {
		const id = askId(comment.body);
		if (id !== null) {
			latest.set(id, index);
		}
	});
	let found: OpenAsk | null = null;
	for (const [id, index] of latest) {
		const comment = ordered[index];
		if (comment === undefined || !addressedToLev(comment.body, pmBot)) {
			continue;
		}
		if (askClosed(ordered.slice(index + 1), id)) {
			continue;
		}
		if (found === null || index > found.index) {
			const headline = askHeadline(comment.body);
			found = {
				headline,
				question: askQuestion(comment.body, headline),
				options: askOptions(comment.body),
				tags: matchedByName(comment.body) ? ["matched by name"] : [],
				index,
			};
		}
	}
	return found;
}

function levReply(comments: Comment[], askIndex: number): Comment | null {
	const ordered = orderedComments(comments);
	const ask = ordered[askIndex];
	if (ask === undefined) {
		return null;
	}
	const id = askId(ask.body);
	for (let index = ordered.length - 1; index > askIndex; index -= 1) {
		const comment = ordered[index];
		if (comment === undefined || workcellMarker.test(comment.body)) {
			continue;
		}
		const opening = comment.body.trim();
		if (
			(id !== null && quotesAsk(opening, id)) ||
			answerPrefix.test(opening) ||
			quotesAskText(opening, ask.body)
		) {
			return comment;
		}
	}
	return null;
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
	comments: Comment[],
	reason: NeedsYouItem["reason"],
	pulls: PullRequest[] = [],
): NeedsYouItem {
	const reply = ask === null ? null : levReply(comments, ask.index);
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
				comments,
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
			needsYouItem(
				project,
				"github",
				pullKey(pull),
				pull.title,
				ask,
				comments,
				"ask",
				[pull],
			),
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
			needsYouItem(
				project,
				"github",
				key,
				pull.title,
				null,
				[],
				"awaitingMerge",
				[pull],
			),
		);
	}
	items.sort((left, right) => Number(left.answered) - Number(right.answered));
	return items;
}

const noScope = "no scope";
const noWorkstream = "no workstream";

const scopeInTitle = /^(?:[a-z]+)\(([^)]+)\)!?\s*:|^\[([^\]]+)\]/i;

function scopeOf(title: string): string {
	const match = title.match(scopeInTitle);
	const scope = match?.[1] ?? match?.[2];
	if (scope === undefined || scope.trim() === "") {
		return noScope;
	}
	return scope.trim().toLowerCase();
}

function diagramId(value: string): string {
	const id = [...value]
		.map((char) => {
			if (/[A-Za-z0-9]/.test(char)) {
				return char;
			}
			const code = char.codePointAt(0) ?? 0;
			return `_${code.toString(16)}_`;
		})
		.join("");
	return /^[A-Za-z]/.test(id) ? id : `n_${id}`;
}

function diagramLabel(value: string): string {
	return value.replace(/"/g, "#quot;");
}

type Placed = {
	ticket: Ticket;
	view: TicketView;
	workstream: string;
	theme: string;
};

function parentOf(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): Ticket | undefined {
	const parentKey = ticket.parent;
	if (parentKey === null) {
		return undefined;
	}
	return byKey.get(parentKey.toLowerCase());
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
		const key = parent.key.toLowerCase();
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
	parents: Set<string>,
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
	if (ticket.key !== null && parents.has(ticket.key.toLowerCase())) {
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

function workstreamOf(
	ticket: Ticket,
	root: Ticket,
	tracker: ProjectCounts["tracker"],
	byKey: Map<string, Ticket>,
): string {
	if (tracker === "linear") {
		return linearMilestone(ticket, byKey) ?? noWorkstream;
	}
	if (isEpic(root)) {
		return root.title;
	}
	return ticket.milestone ?? noWorkstream;
}

function placeTickets(
	tickets: Ticket[],
	views: TicketView[],
	tracker: ProjectCounts["tracker"],
): Placed[] {
	const byKey = new Map<string, Ticket>();
	for (const ticket of tickets) {
		if (ticket.key !== null) {
			byKey.set(ticket.key.toLowerCase(), ticket);
		}
	}
	const parents = new Set<string>();
	for (const ticket of tickets) {
		const parent = parentOf(ticket, byKey);
		if (parent?.key !== null && parent?.key !== undefined) {
			parents.add(parent.key.toLowerCase());
		}
	}
	return tickets.flatMap((ticket, index) => {
		const view = views[index];
		if (view === undefined) {
			return [];
		}
		const root = rootOf(ticket, byKey);
		return [
			{
				ticket,
				view,
				workstream: workstreamOf(ticket, root, tracker, byKey),
				theme: themeOf(ticket, root, byKey, parents),
			},
		];
	});
}

function nodeOf(
	placed: Placed,
	project: string,
	tracker: ProjectCounts["tracker"],
): DiagramNode {
	const key = placed.ticket.key ?? placed.view.title;
	return {
		id: diagramId(key),
		label: placed.view.title,
		state: placed.view.state,
		dashed: false,
		project,
		tracker,
		ticket: placed.ticket.key,
	};
}

function externalNode(blocker: CrossProjectBlocker): DiagramNode {
	return {
		id: diagramId(`${blocker.tracker}:${blocker.project}:${blocker.key}`),
		label: `${blocker.project} ${blocker.key}`,
		state: "external",
		dashed: true,
		project: blocker.project,
		tracker: blocker.tracker,
		ticket: blocker.key,
	};
}

const stateFill: Record<TicketState, string> = {
	done: "#8fbc8f",
	dropped: "#9ca3af",
	backlog: "#d0d7de",
	inProgress: "#f0c674",
	inReview: "#9ecbff",
	awaitingMerge: "#b7e1cd",
};

function defineDiagram(diagram: Omit<Diagram, "definition">): Diagram {
	const lines = [`flowchart ${diagram.direction}`];
	for (const node of diagram.nodes) {
		const shape = `["${diagramLabel(node.label)}"]`;
		const klass = node.dashed ? ":::dashed" : `:::${node.state}`;
		lines.push(`  ${node.id}${shape}${klass}`);
	}
	for (const edge of diagram.edges) {
		lines.push(`  ${edge.from} --> ${edge.to}`);
	}
	for (const state of Object.keys(stateFill) as TicketState[]) {
		lines.push(`  classDef ${state} fill:${stateFill[state]}`);
	}
	lines.push("  classDef theme fill:#e8eef7,stroke:#1a5fb4");
	lines.push("  classDef dashed fill:#fff,stroke:#888,stroke-dasharray: 5 5");
	return { ...diagram, definition: `${lines.join("\n")}\n` };
}

function crossNode(
	key: string,
	cross: CrossProjectBlocker[],
): DiagramNode | undefined {
	const outside = cross.find(
		(blocker) => blocker.key.toLowerCase() === key.toLowerCase(),
	);
	return outside === undefined ? undefined : externalNode(outside);
}

function featureDiagrams(
	placed: Placed[],
	project: string,
	tracker: ProjectCounts["tracker"],
	cross: CrossProjectBlocker[],
): Diagram[] {
	const groups = new Map<string, Map<string, Placed[]>>();
	for (const item of placed) {
		const themes = groups.get(item.workstream) ?? new Map<string, Placed[]>();
		const items = themes.get(item.theme) ?? [];
		items.push(item);
		themes.set(item.theme, items);
		groups.set(item.workstream, themes);
	}
	const diagrams: Diagram[] = [];
	const workstreams = [...groups.keys()].sort((left, right) =>
		left.localeCompare(right),
	);
	for (const workstream of workstreams) {
		const themes = groups.get(workstream);
		if (themes === undefined) {
			continue;
		}
		const nodes: DiagramNode[] = [];
		const edges: DiagramEdge[] = [];
		const seen = new Set<string>();
		for (const theme of [...themes.keys()].sort((left, right) =>
			left.localeCompare(right),
		)) {
			const themeId = diagramId(`${workstream}:${theme}`);
			nodes.push({
				id: themeId,
				label: theme,
				state: "theme",
				dashed: false,
				project,
				tracker,
				ticket: null,
			});
			seen.add(themeId);
			const items = [...(themes.get(theme) ?? [])]
				.map((item) => ({ item, node: nodeOf(item, project, tracker) }))
				.sort((left, right) => left.node.id.localeCompare(right.node.id));
			for (const { item, node } of items) {
				if (!seen.has(node.id)) {
					nodes.push(node);
					seen.add(node.id);
				}
				edges.push({ from: themeId, to: node.id });
				for (const key of item.view.blockers) {
					const external = crossNode(key, cross);
					if (external === undefined) {
						continue;
					}
					if (!seen.has(external.id)) {
						nodes.push(external);
						seen.add(external.id);
					}
					edges.push({ from: external.id, to: node.id });
				}
			}
		}
		diagrams.push(
			defineDiagram({
				id: diagramId(`map:${workstream}`),
				title: workstream,
				direction: "TD",
				nodes,
				edges,
			}),
		);
	}
	return diagrams;
}

function chainDiagrams(
	placed: Placed[],
	project: string,
	tracker: ProjectCounts["tracker"],
	cross: CrossProjectBlocker[],
): Diagram[] {
	const blocked = placed.filter((item) => item.view.blocked === true);
	if (blocked.length === 0) {
		return [];
	}
	const nodes: DiagramNode[] = [];
	const edges: DiagramEdge[] = [];
	const seen = new Set<string>();
	const add = (node: DiagramNode) => {
		if (seen.has(node.id)) {
			return;
		}
		seen.add(node.id);
		nodes.push(node);
	};
	for (const item of blocked) {
		const node = nodeOf(item, project, tracker);
		add(node);
		for (const key of item.view.blockers) {
			const local = placed.find(
				(candidate) =>
					candidate.ticket.key?.toLowerCase() === key.toLowerCase(),
			);
			if (local !== undefined) {
				const blocker = nodeOf(local, project, tracker);
				add(blocker);
				edges.push({ from: blocker.id, to: node.id });
				continue;
			}
			const external = crossNode(key, cross);
			if (external === undefined) {
				continue;
			}
			add(external);
			edges.push({ from: external.id, to: node.id });
		}
	}
	nodes.sort((left, right) => left.id.localeCompare(right.id));
	edges.sort((left, right) =>
		`${left.from} ${left.to}`.localeCompare(`${right.from} ${right.to}`),
	);
	return [
		defineDiagram({
			id: "blocking_chains",
			title: "Blocking chains",
			direction: "LR",
			nodes,
			edges,
		}),
	];
}

function summaryLine(counts: ProjectBody): string {
	return `${counts.name}: ${counts.done} done, ${counts.dropped} dropped, ${counts.blocked} blocked, ${counts.inProgress} in progress, ${counts.backlog} backlog.`;
}

export function projectReport(
	counts: ProjectBody,
	tickets: Ticket[],
	lanes: Lane[],
	relationsByKey: Map<string, ReturnType<typeof ticketRelations>> = new Map(),
	pullByKey: Map<string, string> = new Map(),
	needs: NeedsYouItem[] = [],
	runByKey: Map<string, LiveRun> = new Map(),
): ProjectReport {
	const placed = placeTickets(tickets, counts.tickets, counts.tracker);
	const maps = featureDiagrams(
		placed,
		counts.name,
		counts.tracker,
		counts.crossProjectBlockers,
	);
	const chains = chainDiagrams(
		placed,
		counts.name,
		counts.tracker,
		counts.crossProjectBlockers,
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
		...counts.unlinkedPrs.map((pull) => ({
			key: `${pull.repo}#${pull.number}`,
			title: pull.title,
			state: "inProgress" as const,
			blockers: [],
		})),
	];
	const backlog = counts.tickets.filter((ticket) => ticket.state === "backlog");
	const sections: ReportSection[] = [
		{ id: "summary", title: "Summary", text: summaryLine(counts) },
		{ id: "featureMap", title: "Feature map", diagrams: maps },
		{ id: "inFlight", title: "In flight", items: inFlight },
		{ id: "blockingChains", title: "Blocking chains", diagrams: chains },
		{
			id: "needsYou",
			title: "Needs you",
			needsYou: needs,
		},
		{ id: "backlog", title: "Backlog", items: backlog },
	];
	const needsKeys = new Set(needs.map((item) => item.key.toLowerCase()));
	const boardTickets = counts.tickets.map((view) => {
		const relations =
			view.key === null
				? undefined
				: relationsByKey.get(view.key.toLowerCase());
		const pull =
			view.key === null ? undefined : pullByKey.get(view.key.toLowerCase());
		const commentRun =
			view.key === null ? undefined : runByKey.get(view.key.toLowerCase());
		return {
			...view,
			...(commentRun === undefined ? {} : { run: commentRun }),
			...(relations === undefined ? {} : { blockers: relations.blockers }),
			...(relations === undefined || relations.outsideBlockers.length === 0
				? {}
				: { outsideBlockers: relations.outsideBlockers }),
			...(relations === undefined || relations.blocks.length === 0
				? {}
				: { blocks: relations.blocks }),
			...(pull === undefined ? {} : { pull }),
			...(view.key !== null && needsKeys.has(view.key.toLowerCase())
				? { needsYou: true as const }
				: {}),
		};
	});
	return {
		name: counts.name,
		tracker: counts.tracker,
		lanes,
		tickets: boardTickets,
		sections,
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
	const kept = report.tickets.filter((item) => {
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
		const cap = laneAgeCap(view.maxAgeDays, item.lane ?? "", item.statusType);
		if (cap > 0 && ageDays(item.enteredStateAt, now) > cap) {
			return false;
		}
		if (needle === "") {
			return true;
		}
		const key = item.key?.toLowerCase() ?? "";
		return key.includes(needle) || item.title.toLowerCase().includes(needle);
	});
	return { ...report, tickets: kept };
}
