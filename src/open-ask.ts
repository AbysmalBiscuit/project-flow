import { type Ask, namesLev, readAsks } from "./ask.ts";
import type { Comment } from "./domain.ts";

const decisionRecord = /^\**\s*decision\b/i;

const nameCue =
	/\b(?:waits on|held for|left for|decision|verify|restore|passphrase|signing key)\b/i;

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

export type OpenAsk = Ask & { tags: string[] };

export function openAsk(comments: Comment[], pmBot: boolean): OpenAsk | null {
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
