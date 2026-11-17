import * as stylex from "@stylexjs/stylex";

import type { RunResult } from "./kinds.ts";
import { colours, font, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import type { WorkflowCard } from "./workflows-page.ts";
import { workflowsCopy } from "./workflows-terms.ts";

const cardsStyles = stylex.create({
	pill: {
		display: "inline-flex",
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontFamily: font.mono,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	since: {
		color: colours.inkSoft,
		fontSize: type.meta,
		whiteSpace: "nowrap",
	},
});

export const resultDot: Record<RunResult, stylex.StyleXStyles> = stylex.create({
	merged: { backgroundColor: colours.awaitingMerge },
	prOpen: { backgroundColor: colours.accent },
	noPr: { backgroundColor: colours.inkSoft },
	failed: { backgroundColor: colours.danger },
	cancelled: { backgroundColor: colours.lineStrong },
});

export const tabs = ["diagram", "stages", "roles", "runs"] as const;

export type Tab = (typeof tabs)[number];

const shortSha = (sha: string) => sha.slice(0, 7);

export const versionKey = (card: Pick<WorkflowCard, "package" | "sha">) =>
	JSON.stringify([card.package, card.sha]);

export function Sha({
	sha,
	prefix = false,
}: {
	sha: string | null;
	prefix?: boolean;
}) {
	const text =
		sha === null
			? workflowsCopy.noSha
			: prefix
				? workflowsCopy.sha(shortSha(sha))
				: shortSha(sha);
	return (
		<span className={clsx(cardsStyles.pill)} title={sha ?? undefined}>
			{text}
		</span>
	);
}

/** Since when a version runs: the start of its first run in the run history. */
export function Since({ card }: { card: WorkflowCard }) {
	return card.firstRunAt === null ? null : (
		<span className={clsx(cardsStyles.since)}>
			{workflowsCopy.since(card.firstRunAt)}
		</span>
	);
}

export type Column<K extends string> = {
	key: K;
	label: string;
	number?: boolean;
};
