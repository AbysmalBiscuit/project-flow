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
import { blockerProject, openBlockers, parseBodies } from "./blockers.ts";
import type { AutoMerge, Configuration, ProjectPin } from "./configuration.ts";
import { type KnownBot, knownBots } from "./known-bots.ts";
import {
	appLaneNames,
	closedLaneType,
	emptyStatusTypes,
	laneForTicket,
	lanesFor,
	laterState,
	placeOnBoard,
} from "./lanes.ts";
import {
	branchLinksTicket,
	closesTicket,
	linked,
	ticketRelations,
} from "./links.ts";
import { staleView } from "./poll-merge.ts";
import { type ProjectRef, repoKey } from "./project-ref.ts";
import { projectReport } from "./report.ts";
import type { HidingFilter } from "./terms.ts";
import { asRef, indexTickets, known, parseKey } from "./ticket-index.ts";
import {
	blockerClearedId,
	commentNotificationId,
	foldKey,
	githubKey,
	itemId,
	keyTracker,
	needsYouNotificationId,
	needsYouSeenId,
	pullKey,
	sameTicketKey,
	ticketId,
	ticketRefId,
} from "./ticket-key.ts";
import type { GroupBy } from "./view-settings.ts";

export type WorkcellRun = {
	key: string;
	status: "running" | "failed";
	repo?: string;
};

export type LiveRun = {
	status: "running" | "failed";
	stage?: string;
};

export type StatusType =
	| "backlog"
	| "inProgress"
	| "inReview"
	| "awaitingMerge"
	| "done"
	| "dropped";

export type StatusColours = Record<StatusType, string>;

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

export type PollReconcile = {
	rows: Snapshot[];
	projectErrors: { ref: ProjectRef; error: string }[];
	globalError: string | null;
};

/** The tickets of one project, with its repo when the project is a GitHub repo. */
export type ProjectGroup = {
	project: string;
	repo: string | null;
	tickets: Ticket[];
};

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

export type GroupKey = Exclude<GroupBy, "none">;

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
