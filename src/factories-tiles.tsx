import * as stylex from "@stylexjs/stylex";

import type { FactoriesPage } from "./factories-page.ts";
import { styles } from "./factories-parts.tsx";
import { factoriesCopy, spanText } from "./factories-terms.ts";
import { costLabel } from "./run-terms.ts";
import { colours, measure, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const tilesStyles = stylex.create({
	tiles: {
		gridTemplateColumns: `repeat(auto-fit, minmax(${measure.tileMin}, 1fr))`,
	},
	kicker: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	tileValue: {
		color: colours.ink,
		fontSize: type.tileValue,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
	},
	tileWarn: {
		color: colours.warn,
	},
	tileBad: {
		color: colours.danger,
	},
	tileDetail: {
		display: "-webkit-box",
		overflow: "hidden",
		color: colours.inkSoft,
		fontSize: type.meta,
		overflowWrap: "anywhere",
		WebkitBoxOrient: "vertical",
		WebkitLineClamp: 2,
	},
});

export const since = (
	time: string | null | undefined,
	now: number,
): string | null =>
	time === null || time === undefined ? null : spanText(now - Date.parse(time));

function Tile({
	label,
	value,
	detail,
	tone,
}: {
	label: string;
	value: string;
	detail: string;
	tone?: "warn" | "bad";
}) {
	return (
		<div className={clsx(styles.card)}>
			<div className={clsx(tilesStyles.kicker)}>{label}</div>
			<div
				className={clsx(
					tilesStyles.tileValue,
					tone === "warn" && tilesStyles.tileWarn,
					tone === "bad" && tilesStyles.tileBad,
				)}
			>
				{value}
			</div>
			<div className={clsx(tilesStyles.tileDetail)} title={detail}>
				{detail}
			</div>
		</div>
	);
}

export function Tiles({ page, now }: { page: FactoriesPage; now: number }) {
	const { tiles } = page;
	const wait = since(tiles.longestWaitSince, now);
	return (
		<div className={clsx(styles.grid, tilesStyles.tiles)}>
			<Tile
				label={factoriesCopy.tiles.running}
				value={String(tiles.running)}
				detail={
					tiles.slots === null
						? factoriesCopy.noSlots
						: factoriesCopy.ofSlots(tiles.slots.total)
				}
			/>
			<Tile
				label={factoriesCopy.tiles.queued}
				value={String(tiles.queued)}
				detail={
					wait === null ? factoriesCopy.noWait : factoriesCopy.longestWait(wait)
				}
			/>
			<Tile
				label={factoriesCopy.tiles.attention}
				value={String(tiles.attention.total)}
				detail={factoriesCopy.attentionParts(
					tiles.attention.failed,
					tiles.attention.stalled,
					tiles.attention.asks,
				)}
				{...(tiles.attention.total > 0 ? { tone: "warn" as const } : {})}
			/>
			<Tile
				label={factoriesCopy.tiles.merged}
				value={String(tiles.merged.last)}
				detail={factoriesCopy.versus(tiles.merged.last - tiles.merged.before)}
			/>
			<Tile
				label={factoriesCopy.tiles.failures}
				value={String(tiles.failed.last)}
				detail={factoriesCopy.reasons(tiles.failed.reasons)}
				{...(tiles.failed.last > 0 ? { tone: "bad" as const } : {})}
			/>
			<Tile
				label={factoriesCopy.tiles.cost}
				value={`$${Math.round(tiles.cost.last)}`}
				detail={factoriesCopy.perMerged(
					tiles.cost.perMerged === null
						? null
						: costLabel(tiles.cost.perMerged),
				)}
			/>
		</div>
	);
}
