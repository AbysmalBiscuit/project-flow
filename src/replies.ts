import type { Ticket } from "./domain.ts";
import { openAsk } from "./open-ask.ts";

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
