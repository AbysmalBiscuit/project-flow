import type { AskOption, Comment } from "./domain.ts";

export const progressHeading = "**Workcell progress**";

const askMarker = /<!--\s*workcell:ask\s+([A-Za-z0-9_.-]+)\s*-->/i;
const workcellMarker = /<!--\s*workcell:/i;
const answerPrefix = /^(?:senior|reply|answer)\b/i;
const numberedOption = /^(\d+)[.)]\s+(\S.*)$/;

/** A `reply` is Lev's answer; a `record` is an id quote or progress line. */
export type AskAnswer = { by: "reply" | "record"; comment: Comment };

export type Ask = {
	id: string;
	comment: Comment;
	headline: string;
	question: string;
	options: AskOption[];
	open: boolean;
	answer: AskAnswer | null;
};

export function askId(body: string): string | null {
	return body.match(askMarker)?.[1] ?? null;
}

export function namesLev(body: string): boolean {
	return /\blev\b/i.test(body);
}

export function orderedComments(comments: Comment[]): Comment[] {
	return comments.every((comment) => comment.createdAt === undefined)
		? comments
		: [...comments].sort(
				(left, right) => commentTime(left) - commentTime(right),
			);
}

function commentTime(comment: Comment): number {
	if (comment.createdAt === undefined) {
		return 0;
	}
	const parsed = Date.parse(comment.createdAt);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/** Reads the latest comment for each ask id, in comment order. */
export function readAsks(comments: Comment[]): Ask[] {
	const ordered = orderedComments(comments);
	const latest = new Map<string, number>();
	ordered.forEach((comment, index) => {
		const id = askId(comment.body);
		if (id !== null) {
			latest.set(id, index);
		}
	});
	return [...latest]
		.sort(([, left], [, right]) => left - right)
		.flatMap(([id, index]) => {
			const comment = ordered[index];
			if (comment === undefined) {
				return [];
			}
			const headline = askHeadline(comment.body);
			const answer = askAnswer(ordered, comment);
			return [
				{
					id,
					comment,
					headline,
					question: askQuestion(comment.body, headline),
					options: askOptions(comment.body),
					open: answer === null,
					answer,
				},
			];
		});
}

/**
 * Decides if a comment after the ask, or a progress comment anywhere,
 * answers the ask. A record wins over a reply, and the latest reply wins.
 */
export function askAnswer(comments: Comment[], ask: Comment): AskAnswer | null {
	const id = askId(ask.body);
	if (id === null) {
		return null;
	}
	const askAt = comments.indexOf(ask);
	const later = comments.slice(askAt + 1);
	const record = comments.find(
		(comment, index) =>
			(index > askAt && quotesAsk(comment.body, id)) ||
			(isProgress(comment.body) &&
				comment.body
					.split("\n")
					.some((line) =>
						progressAnswers(line.trim().replace(/^-\s*/, ""), id),
					)),
	);
	if (record !== undefined) {
		return { by: "record", comment: record };
	}
	const reply = later.findLast((comment) => {
		if (workcellMarker.test(comment.body) || isProgress(comment.body)) {
			return false;
		}
		const opening = comment.body.trim();
		return answerPrefix.test(opening) || quotesAskText(opening, ask.body);
	});
	return reply === undefined ? null : { by: "reply", comment: reply };
}

/**
 * Tells if one progress line settles the ask: "ask-N answered" or a
 * "human picks" entry. N is the full ask id or its last part.
 */
export function progressAnswers(line: string, id: string): boolean {
	const number = id.split("-").at(-1) ?? id;
	const label = new RegExp(
		`^ask-(?:${escaped(id)}|${escaped(number)})(?![A-Za-z0-9_.-])`,
		"i",
	);
	const named = line.match(label);
	if (named === null) {
		return false;
	}
	const rest = line.slice(named[0].length);
	return /^\s+answered\b/i.test(rest) || /\bhuman picks\b/i.test(rest);
}

function isProgress(body: string): boolean {
	return body.trimStart().startsWith(progressHeading);
}

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quotesAsk(body: string, id: string): boolean {
	return new RegExp(
		`(?<![A-Za-z0-9_.-])${escaped(id)}(?![A-Za-z0-9_.-])`,
		"i",
	).test(body);
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

export function askHeadline(body: string): string {
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
