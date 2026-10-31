import type { Configuration } from "./configuration.ts";
import type {
	Attention,
	Comment,
	FactoryRun,
	NeedsYouItem,
	NeedsYouRules,
	Notification,
	NotificationTrigger,
	ProjectCounts,
	PullRequest,
	Snapshot,
	Ticket,
	TicketState,
	TrackerKind,
} from "./domain.ts";
import { openImportantQuestions } from "./important-questions.ts";
import type { KnownBot } from "./known-bots.ts";
import {
	type OpenAsk,
	openAsk,
	projectHasPmBot,
	routedQuestion,
} from "./open-ask.ts";
import { settingsKey } from "./project-ref.ts";
import { linked } from "./pull-links.ts";
import {
	type AutoMergeSources,
	mergesOnItsOwn,
	pullStatus,
	reviewState,
} from "./review.ts";
import {
	blockerClearedId,
	commentNotificationId,
	itemId,
	needsYouNotificationId,
	needsYouSeenId,
	pullKey,
	sameTicketKey,
	ticketId,
	ticketRefId,
} from "./ticket-key.ts";

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
				projectHasPmBot(
					pmBot,
					settingsKey(view.row.key, view.row.host),
					view.row.tracker,
				),
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
				tracker: item.tracker,
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
		item: { project: string; tracker: TrackerKind; key: string },
		text: string,
	) => {
		if (seen.has(key)) {
			return;
		}
		found.push({
			id: key,
			trigger,
			project: item.project,
			tracker: item.tracker,
			key: item.key,
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
			push("needsYou", needsYouNotificationId(item, at), item, item.headline);
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
				comment,
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
				blocker,
				blocker.title,
			);
		}
	}
	return found;
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
	factoryAsk?: NeedsYouItem["factoryAsk"],
): NeedsYouItem {
	const reply = ask?.answer?.comment ?? null;
	const pull = pulls.find((item) => !item.merged) ?? pulls[0];
	const openQuestions =
		reason === "awaitingMerge"
			? pulls
					.filter((item) => !item.merged)
					.flatMap((item) => openImportantQuestions(item.body)).length
			: 0;
	return {
		project,
		tracker,
		key,
		headline: ask?.headline ?? title,
		reason: openQuestions > 0 ? "decide" : reason,
		...(openQuestions > 0 ? { openQuestions } : {}),
		tags: ask?.tags ?? [],
		answered: reply !== null,
		acknowledged: (reply?.reactions ?? 0) > 0,
		...(ask === null ? {} : { question: ask.question, options: ask.options }),
		...(pull === undefined ? {} : { pull: pullStatus(pull) }),
		...(factoryAsk === undefined ? {} : { factoryAsk }),
	};
}

/**
 * The ask of a blocked run. A run whose questions are unknown asks with the ticket title.
 * A run whose open questions all go to the PM Bot gives no ask.
 */
function runAsk(
	run: FactoryRun | undefined,
	pmBot: boolean,
): { ask: OpenAsk | null; factoryAsk?: NeedsYouItem["factoryAsk"] } | null {
	if (run === undefined) {
		return null;
	}
	if (run.questions === undefined) {
		return { ask: null };
	}
	const question = routedQuestion(run.questions, pmBot);
	if (question === undefined) {
		return null;
	}
	return {
		ask: {
			id: question.id,
			comment: { body: question.text },
			headline: question.text,
			question: question.text,
			options: [],
			open: true,
			answer: null,
			tags: [],
		},
		factoryAsk: { factory: run.factory, run: run.id, question: question.id },
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
	blockedRuns: Map<string, FactoryRun>,
	rules: NeedsYouRules,
	autoMerge: AutoMergeSources,
	workcellPulls: ReadonlySet<string>,
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
		const commentAsk = openAsk(comments, rules.pmBot);
		const fromRun =
			commentAsk === null
				? runAsk(blockedRuns.get(ticket.key), rules.pmBot)
				: null;
		const ask = commentAsk ?? fromRun?.ask ?? null;
		const labelled =
			assignedToViewer(ticket, viewers) &&
			ticket.labels.some((label) => labels.has(label.toLowerCase()));
		const awaiting = shown === "awaitingMerge";
		const failed = failedKeys.has(ticket.key);
		const asked = ask !== null || fromRun !== null;
		if (!asked && !labelled && !awaiting && !failed) {
			continue;
		}
		items.push(
			needsYouItem(
				project,
				tracker,
				ticket.key,
				ticket.title,
				ask,
				asked
					? "ask"
					: awaiting
						? "awaitingMerge"
						: failed
							? "runFailed"
							: "label",
				linkedPulls,
				fromRun?.factoryAsk,
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
		if (mergesOnItsOwn([pull], project, projectKey, autoMerge, workcellPulls)) {
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
