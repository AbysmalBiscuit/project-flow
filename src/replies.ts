import type {
	Comment,
	PostedReply,
	ReplyRequest,
	Snapshot,
	Ticket,
} from "./domain.ts";
import { openAsk, projectHasPmBot } from "./open-ask.ts";
import { settingsKey } from "./project-ref.ts";
import { githubKeyParts, sameTicketKey } from "./ticket-key.ts";

type ReplyTarget = Pick<ReplyRequest, "tracker" | "project" | "key">;

/** A reply as the panel sends it: a body, or the number of an ask option. */
export type ReplyDraft = ReplyTarget & {
	body?: string | undefined;
	option?: number | undefined;
	parentId?: string | undefined;
	kind?: ReplyRequest["kind"] | undefined;
};

/**
 * The stored project of a ticket: by its key, its name, or the repo of a GitHub ticket key.
 * A project on a declared host matches only by its name, which holds the host.
 */
export function ticketSnapshot(
	rows: Snapshot[],
	reply: ReplyTarget,
): Snapshot | undefined {
	const repo =
		reply.tracker === "github" ? githubKeyParts(reply.key)?.repo : undefined;
	return rows.find((item) => {
		if (item.tracker !== reply.tracker) {
			return false;
		}
		if (item.host !== undefined) {
			return item.name === reply.project;
		}
		if (item.key === reply.project || item.name === reply.project) {
			return true;
		}
		return repo !== undefined && item.key === repo;
	});
}

function optionReplyBody(
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

function panelReplyBody(
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

/** The request to post for a draft, or the reason the draft cannot be posted. */
export function replyRequest(
	rows: Snapshot[],
	draft: ReplyDraft,
	pmBots: Record<string, boolean>,
): { reply: ReplyRequest } | { error: string } {
	const row = ticketSnapshot(rows, draft);
	const ticket = row?.tickets.find(
		(item) => item.key !== null && sameTicketKey(item.key, draft.key),
	);
	const pmBot = projectHasPmBot(
		pmBots,
		row === undefined ? draft.project : settingsKey(row.key, row.host),
		draft.tracker,
	);
	const picked =
		draft.option === undefined
			? null
			: optionReplyBody(ticket, draft.option, pmBot);
	if (draft.option !== undefined && picked === null) {
		return { error: "option not found" };
	}
	const text = picked ?? draft.body ?? "";
	if (text.trim() === "") {
		return { error: "reply is empty" };
	}
	return {
		reply: {
			tracker: draft.tracker,
			project: draft.project,
			key: draft.key,
			body: panelReplyBody(ticket, text, pmBot, draft.parentId),
			...(draft.parentId === undefined ? {} : { parentId: draft.parentId }),
			...(draft.kind === undefined ? {} : { kind: draft.kind }),
		},
	};
}

/** The stored project with the posted reply added to its ticket, so the next read shows it before a poll. */
export function recordedReply(
	rows: Snapshot[],
	reply: ReplyRequest,
	created: PostedReply,
): Snapshot | undefined {
	const row = ticketSnapshot(rows, reply);
	if (row === undefined) {
		return undefined;
	}
	const comment: Comment = {
		body: created.body,
		createdAt: created.createdAt,
	};
	return {
		...row,
		tickets: row.tickets.map((ticket) =>
			ticket.key !== null && sameTicketKey(ticket.key, reply.key)
				? { ...ticket, comments: [...(ticket.comments ?? []), comment] }
				: ticket,
		),
	};
}
