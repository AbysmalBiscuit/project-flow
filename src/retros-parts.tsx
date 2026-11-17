import type * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { factoriesCopy, spanText } from "./factories-terms.ts";
import type { RetroDetail, RetrosPage, Smoothness } from "./retros-page.ts";
import { styles } from "./retros-styles.ts";
import { costLabel } from "./run-terms.ts";
import { clsx } from "./ui.ts";
import { retrosCopy } from "./workflows-terms.ts";

const smoothnessTone: Record<Smoothness, stylex.StyleXStyles> = {
	smooth: styles.pillOk,
	bumpy: styles.pillInfo,
	rough: styles.pillWarn,
	stalled: styles.pillBad,
	failed: styles.pillBad,
};

export const span = (seconds: number): string => spanText(seconds * 1_000);

/** Lost time under a minute reads `0m`, as the run lost no whole minute. */
export const lost = (seconds: number): string =>
	seconds < 60 ? "0m" : span(seconds);

export function SmoothnessPill({ level }: { level: Smoothness }) {
	return (
		<span className={clsx(styles.pill, smoothnessTone[level])}>{level}</span>
	);
}

export function Source({
	children,
	store = false,
	need = false,
	next = false,
}: {
	children: string;
	store?: boolean;
	need?: boolean;
	/** A source after another source in the same head. */
	next?: boolean;
}) {
	return (
		<span
			className={clsx(
				styles.source,
				store && styles.sourceStore,
				need && styles.sourceNeed,
				next && styles.sourceNext,
			)}
		>
			{children}
		</span>
	);
}

export function Card({
	title,
	head,
	children,
}: {
	title: ReactNode;
	head: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className={clsx(styles.card)}>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{title}</h2>
				{head}
			</div>
			{children}
		</section>
	);
}

export function Tiles({ retro }: { retro: RetroDetail }) {
	const tiles = [
		[retrosCopy.tiles.duration, span(retro.durationS)],
		[retrosCopy.tiles.cost, costLabel(retro.costUsd)],
		[retrosCopy.tiles.rounds, String(retro.rounds)],
		[retrosCopy.tiles.retries, String(retro.retries)],
		[retrosCopy.tiles.lost, lost(retro.timeLostS)],
	] as const;
	return (
		<div className={clsx(styles.grid, styles.tiles)}>
			{tiles.map(([label, value]) => (
				<div key={label}>
					<div className={clsx(styles.kicker)}>{label}</div>
					<div className={clsx(styles.tileValue)}>{value}</div>
				</div>
			))}
		</div>
	);
}

export function NotServed({ page }: { page: RetrosPage }) {
	return page.notServed.map((factory) => (
		<p key={factory} className={clsx(styles.note)}>
			{factoriesCopy.notServed(factory, retrosCopy.sources.route)}
		</p>
	));
}
