import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { Dropdown } from "./dropdown.tsx";
import { factoriesCopy } from "./factories-terms.ts";
import { type RangeDays, rangeDays } from "./factories-view.ts";
import {
	colours,
	font,
	measure,
	media,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

export const styles = stylex.create({
	grid: {
		display: "grid",
		gap: space.lg,
		marginBottom: space.lg,
	},
	two: {
		gridTemplateColumns: {
			default: "minmax(0, 2fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
		alignItems: "start",
	},
	card: {
		boxSizing: "border-box",
		minWidth: 0,
		padding: space.lg,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
	},
	stretch: {
		display: "flex",
		flexDirection: "column",
		alignSelf: "stretch",
	},
	grow: {
		flexGrow: 1,
		minWidth: 0,
	},
	head: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		marginBottom: space.md,
	},
	heading: {
		margin: 0,
		color: colours.ink,
		fontSize: type.heading,
		fontWeight: type.weight,
	},
	source: {
		marginLeft: "auto",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	sourceNeed: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	sourceAggregate: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	sourceNext: {
		marginLeft: 0,
	},
	pill: {
		display: "inline-flex",
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	pillBad: {
		backgroundColor: colours.dangerWash,
		color: colours.danger,
	},
	pillWarn: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	bar: {
		display: "flex",
		height: measure.meterBar,
		overflow: "hidden",
		borderRadius: radius.pill,
		backgroundColor: colours.meterTrack,
	},
	levelWarn: {
		backgroundColor: colours.warn,
	},
	note: {
		margin: `${space.sm} 0 0`,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	scroll: {
		overflowX: "auto",
	},
	table: {
		width: "100%",
		borderCollapse: "collapse",
		fontVariantNumeric: "tabular-nums",
	},
	th: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
		color: colours.inkSoft,
		fontSize: type.lane,
		fontWeight: type.weight,
		letterSpacing: type.headTrack,
		textAlign: "left",
		textTransform: "uppercase",
		whiteSpace: "nowrap",
	},
	row: {
		backgroundColor: {
			default: null,
			":hover": colours.surface,
		},
	},
	td: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
		verticalAlign: "middle",
	},
	lastRow: {
		borderBottomWidth: 0,
	},
	number: {
		textAlign: "right",
	},
	nowrap: {
		whiteSpace: "nowrap",
	},
	wide: {
		display: {
			default: null,
			[media.projectBar]: "none",
		},
	},
	stepCurrent: {
		backgroundColor: colours.accent,
	},
	merged: {
		backgroundColor: colours.awaitingMerge,
	},
	failed: {
		backgroundColor: colours.danger,
	},
	stopped: {
		backgroundColor: colours.inkSoft,
	},
	legend: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.md,
		marginTop: space.twoXs,
		color: colours.inkSoft,
		fontSize: type.lane,
	},
	swatch: {
		display: "inline-block",
		width: measure.legendSwatch,
		height: measure.legendSwatch,
		marginRight: space.twoXs,
		borderRadius: measure.hairline,
	},
	legendItem: {
		display: "inline-flex",
		alignItems: "center",
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
});

export function Source({
	children,
	need = false,
	aggregate = false,
	next = false,
}: {
	children: string;
	need?: boolean;
	/** A source that Project Flow computes from its own store. */
	aggregate?: boolean;
	/** A source after another source in the same row. */
	next?: boolean;
}) {
	return (
		<span
			className={clsx(
				styles.source,
				need && styles.sourceNeed,
				aggregate && styles.sourceAggregate,
				next && styles.sourceNext,
			)}
		>
			{children}
		</span>
	);
}

export function Card({
	title,
	source,
	aggregate,
	children,
	stretch = false,
	tools,
}: {
	title: string;
	source?: string;
	aggregate?: string;
	children: ReactNode;
	stretch?: boolean;
	/** Controls after the sources, at the end of the card head. */
	tools?: ReactNode;
}) {
	return (
		<section
			className={clsx(styles.card, stretch && styles.stretch)}
			aria-label={title}
		>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{title}</h2>
				{source === undefined ? null : <Source>{source}</Source>}
				{aggregate === undefined ? null : (
					<Source aggregate next={source !== undefined}>
						{aggregate}
					</Source>
				)}
				{tools}
			</div>
			{children}
		</section>
	);
}

const rangeChoices = rangeDays.map((days) => ({
	id: String(days),
	label: factoriesCopy.range(days),
}));

/** Picks the days that a chart of the Factories tab shows. */
export function RangePicker({
	id,
	chart,
	days,
	onChange,
}: {
	id: string;
	chart: string;
	days: RangeDays;
	onChange: (days: RangeDays) => void;
}) {
	return (
		<Dropdown
			id={id}
			label={factoriesCopy.rangeLabel(chart)}
			value={String(days)}
			choices={rangeChoices}
			steadyWidth
			onChange={(choice) => {
				const picked = rangeDays.find((days) => String(days) === choice);
				if (picked !== undefined) {
					onChange(picked);
				}
			}}
		/>
	);
}
