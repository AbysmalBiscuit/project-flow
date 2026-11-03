import { z } from "zod";

import type { ThreadReaction } from "./domain.ts";

/** Emoji of the shortcodes that GitHub and Linear name reactions by. */
const shortcodeEmoji: Record<string, string> = {
	"+1": "👍",
	thumbsup: "👍",
	"-1": "👎",
	thumbsdown: "👎",
	laugh: "😄",
	smile: "😄",
	joy: "😂",
	hooray: "🎉",
	tada: "🎉",
	confused: "😕",
	heart: "❤️",
	rocket: "🚀",
	eyes: "👀",
	white_check_mark: "✅",
	heavy_check_mark: "✔️",
	ok_hand: "👌",
	raised_hands: "🙌",
	raised_hand_with_fingers_splayed: "🖐️",
	clap: "👏",
	pray: "🙏",
	fire: "🔥",
	"100": "💯",
	thinking_face: "🤔",
	face_exhaling: "😮‍💨",
	face_in_clouds: "😶‍🌫️",
	ticket: "🎫",
	warning: "⚠️",
	x: "❌",
	wave: "👋",
	sparkles: "✨",
};

/** A shortcode with no known emoji, such as a custom Linear emoji, shows as `:name:`. */
function reactionEmoji(name: string): string {
	return shortcodeEmoji[name] ?? (/^[\w+-]+$/.test(name) ? `:${name}:` : name);
}

/** One pill for each emoji, in the order of the first reaction with it. */
function countedReactions(
	reactions: { name: string; count: number }[],
): ThreadReaction[] {
	const counts = new Map<string, number>();
	for (const { name, count } of reactions) {
		if (count > 0) {
			const emoji = reactionEmoji(name);
			counts.set(emoji, (counts.get(emoji) ?? 0) + count);
		}
	}
	return [...counts].map(([emoji, count]) => ({ emoji, count }));
}

/** The sum of the pill counts: the reaction count of a comment. */
export function reactionTotal(reactions: ThreadReaction[]): number {
	return reactions.reduce((total, { count }) => total + count, 0);
}

const reactionCount = z.number().optional();

/** The reaction counts that GitHub REST puts on each issue comment and review comment. */
export const githubRestReactions = z.object({
	"+1": reactionCount,
	"-1": reactionCount,
	laugh: reactionCount,
	hooray: reactionCount,
	confused: reactionCount,
	heart: reactionCount,
	rocket: reactionCount,
	eyes: reactionCount,
});

export function restReactions(
	reactions: z.infer<typeof githubRestReactions> | undefined,
): ThreadReaction[] {
	return countedReactions(
		Object.entries(reactions ?? {}).map(([name, count]) => ({
			name,
			count: count ?? 0,
		})),
	);
}

/** The content enum that GitHub GraphQL names each reaction by. */
export const githubReactionContent = z.enum([
	"THUMBS_UP",
	"THUMBS_DOWN",
	"LAUGH",
	"HOORAY",
	"CONFUSED",
	"HEART",
	"ROCKET",
	"EYES",
]);

const restReactionName = {
	THUMBS_UP: "+1",
	THUMBS_DOWN: "-1",
	LAUGH: "laugh",
	HOORAY: "hooray",
	CONFUSED: "confused",
	HEART: "heart",
	ROCKET: "rocket",
	EYES: "eyes",
} as const satisfies Record<z.infer<typeof githubReactionContent>, string>;

/** The GitHub REST name of a GraphQL reaction content, such as `+1` for `THUMBS_UP`. */
export function reactionName(
	content: z.infer<typeof githubReactionContent>,
): string {
	return restReactionName[content];
}

export const reactionGroupSelection =
	"reactionGroups { content reactors { totalCount } }";

export const githubReactionGroups = z.array(
	z.object({
		content: githubReactionContent,
		reactors: z.object({ totalCount: z.number() }),
	}),
);

export function groupReactions(
	groups: z.infer<typeof githubReactionGroups> | undefined,
): ThreadReaction[] {
	return countedReactions(
		(groups ?? []).map((group) => ({
			name: reactionName(group.content),
			count: group.reactors.totalCount,
		})),
	);
}

export const linearReactionSelection = "reactions { emoji }";

export const linearReactions = z.array(z.object({ emoji: z.string() }));

export function emojiReactions(
	reactions: z.infer<typeof linearReactions> | undefined,
): ThreadReaction[] {
	return countedReactions(
		(reactions ?? []).map(({ emoji }) => ({ name: emoji, count: 1 })),
	);
}
