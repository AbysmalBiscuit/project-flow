import * as stylex from "@stylexjs/stylex";

import { spanText } from "./factories-terms.ts";
import type { RunResult } from "./kinds.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import type { WorkflowCard } from "./workflows-page.ts";
import { styles } from "./workflows-styles.ts";
import { workflowsCopy } from "./workflows-terms.ts";

const cardsStyles = stylex.create({
	pick: {
		display: "block",
		width: "100%",
		color: colours.ink,
		font: "inherit",
		textAlign: "left",
		cursor: "pointer",
		outlineWidth: measure.focus,
		outlineStyle: {
			default: "none",
			":focus-visible": "solid",
		},
		outlineColor: colours.focus,
	},
	picked: {
		outlineStyle: "solid",
		outlineColor: colours.accent,
	},
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
	meta: {
		marginLeft: "auto",
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	since: {
		color: colours.inkSoft,
		fontSize: type.meta,
		whiteSpace: "nowrap",
	},
	stats: {
		display: "flex",
		flexWrap: "wrap",
		gap: measure.statGap,
	},
	stat: {
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	statValue: {
		display: "block",
		color: colours.ink,
		fontSize: type.body,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
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

/** The versions with the latest runs, one row of cards on a desktop. The older ones fold, and a version with no run stays. */
export const newestShown = 3;

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

function Stat({ value, label }: { value: string; label: string }) {
	return (
		<div className={clsx(cardsStyles.stat)}>
			<b className={clsx(cardsStyles.statValue)}>{value}</b>
			{label}
		</div>
	);
}

export function Card({
	card,
	reading,
	picked,
	now,
	onPick,
}: {
	card: WorkflowCard;
	reading: boolean;
	picked: boolean;
	now: number;
	onPick: () => void;
}) {
	const { stats } = workflowsCopy;
	return (
		<button
			type="button"
			className={clsx(
				styles.card,
				cardsStyles.pick,
				picked && cardsStyles.picked,
			)}
			aria-pressed={picked}
			onClick={onPick}
		>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{card.package}</h2>
				<Sha sha={card.sha} />
				<Since card={card} />
				<span className={clsx(cardsStyles.meta)}>
					{card.lastRunAt === null
						? workflowsCopy.noRunYet
						: workflowsCopy.lastRun(spanText(now - Date.parse(card.lastRunAt)))}
				</span>
			</div>
			<div className={clsx(cardsStyles.stats)}>
				<Stat value={String(card.runs)} label={stats.runs} />
				<Stat
					value={
						card.mergeRate === null
							? workflowsCopy.none
							: workflowsCopy.share(card.mergeRate)
					}
					label={reading ? stats.mergedReading : stats.merged}
				/>
				<Stat
					value={workflowsCopy.seconds(card.medianS)}
					label={stats.median}
				/>
				<Stat
					value={workflowsCopy.cost(card.costPerRun)}
					label={stats.perRun}
				/>
			</div>
		</button>
	);
}

export type Column<K extends string> = {
	key: K;
	label: string;
	number?: boolean;
};
