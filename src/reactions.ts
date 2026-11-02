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
export function countedReactions(
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
