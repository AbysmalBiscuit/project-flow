import type { Configuration } from "./configuration.ts";
import type {
	Attention,
	Comment,
	NeedsYouItem,
	Notification,
	NotificationTrigger,
	ProjectCounts,
	PullRequest,
	Snapshot,
	Ticket,
} from "./domain.ts";
import { pullComments } from "./needs-you-items.ts";
import { openAsk, projectHasPmBot } from "./open-ask.ts";
import { settingsKey } from "./project-ref.ts";
import { linked } from "./pull-links.ts";
import {
	attentionItemId,
	blockerClearedId,
	commentNotificationId,
	foldKey,
	needsYouNotificationId,
	needsYouSeenId,
	pullId,
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
	row: Snapshot,
	tickets: Map<string, Ticket>,
	pulls: PullRequest[],
): Comment[] {
	const ticket =
		item.host === row.host
			? tickets.get(ticketId(item.tracker, item.key))
			: undefined;
	if (ticket !== undefined) {
		const linkedPulls = linked(ticket, pulls);
		return [...(ticket.comments ?? []), ...linkedPulls.flatMap(pullComments)];
	}
	const id = foldKey(settingsKey(item.key, item.host));
	const pull = pulls.find((candidate) => pullId(candidate) === id);
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
			const itemComments = commentSources(item, view.row, tickets, pulls);
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
			comments.set(attentionItemId(item), {
				stamp: newest.stamp,
				replyStamp: reply?.createdAt ?? "",
				authors: newest.authors,
				project: item.project,
				tracker: item.tracker,
				key: item.key,
				...(item.host === undefined ? {} : { host: item.host }),
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
	const current = new Set(after.needsYou.map((item) => attentionItemId(item)));
	return before.needsYou.flatMap((item) =>
		!loadedProjects.has(item.project) || current.has(attentionItemId(item))
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
		item: Pick<Notification, "project" | "tracker" | "key" | "host">,
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
			...(item.host === undefined ? {} : { host: item.host }),
			text,
			at,
			read: false,
		});
	};
	if (triggers.needsYou) {
		const previous = new Set(
			before.needsYou.map((item) => attentionItemId(item)),
		);
		for (const item of after.needsYou) {
			const id = attentionItemId(item);
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
				(candidate) => attentionItemId(candidate) === id,
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
