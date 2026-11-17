import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { board } from "./board-styles.ts";
import type { MemoryRow } from "./memories-page.ts";
import { styles } from "./memories-styles.ts";
import { memoriesCopy } from "./memories-terms.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const cardStyles = stylex.create({
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
	pill: {
		display: "inline-flex",
		flexShrink: 0,
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	memory: {
		display: "block",
		boxSizing: "border-box",
		width: "100%",
		margin: 0,
		padding: `${space.sm} 0`,
		borderWidth: 0,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		backgroundColor: {
			default: "transparent",
			":hover": colours.surface,
		},
		color: colours.ink,
		fontFamily: "inherit",
		fontSize: type.menu,
		textAlign: "left",
		cursor: "pointer",
		outline: {
			default: "none",
			":focus-visible": `${measure.focus} solid ${colours.focus}`,
		},
	},
	memoryOn: {
		backgroundColor: {
			default: colours.rowOn,
			":hover": colours.rowOn,
		},
	},
	tags: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		marginTop: space.xs,
	},
	tag: {
		padding: `${space.twoXs} ${space.xs}`,
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.tag,
		overflowWrap: "anywhere",
	},
	row: {
		display: "flex",
		gap: space.sm,
		alignItems: "flex-start",
	},
	check: {
		marginTop: space.sm,
	},
});

export type Picked = { repo: string; id: string };

export type MemorySelection = { repo: string; ids: string[] };

export function Source({ children }: { children: string }) {
	return <span className={clsx(cardStyles.source)}>{children}</span>;
}

export function Pill({ children }: { children: string }) {
	return <span className={clsx(cardStyles.pill)}>{children}</span>;
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
		<section className={clsx(cardStyles.card)}>
			<div className={clsx(cardStyles.head)}>
				<h2 className={clsx(cardStyles.heading)}>{title}</h2>
				{head}
			</div>
			{children}
		</section>
	);
}

function MemoryButton({
	row,
	on,
	onPick,
}: {
	row: MemoryRow;
	on: boolean;
	onPick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			className={clsx(cardStyles.memory, on && cardStyles.memoryOn)}
			onClick={onPick}
		>
			<span className={clsx(styles.pills)}>
				<Pill>{row.kind}</Pill>
				<Pill>{row.state}</Pill>
			</span>
			<span className={clsx(styles.text)}>{row.text}</span>
			<span className={clsx(cardStyles.tags)}>
				{row.paths.map((path) => (
					<span key={path} className={clsx(cardStyles.tag)}>
						{path}
					</span>
				))}
				{row.concepts.map((concept) => (
					<span key={concept} className={clsx(cardStyles.tag)}>
						{concept}
					</span>
				))}
			</span>
			<span className={clsx(styles.votes)}>
				{memoriesCopy.votes(row.votesFor, row.votesAgainst)}
			</span>
		</button>
	);
}

export function MemorySection({
	title,
	rows,
	repo,
	picked,
	onPick,
	selected,
	onToggle,
}: {
	title: string;
	rows: MemoryRow[];
	repo: string;
	picked: Picked | null;
	onPick: (picked: Picked) => void;
	selected: string[];
	onToggle: (id: string) => void;
}) {
	return (
		<div className={clsx(styles.section)}>
			<div className={clsx(styles.kicker, styles.sectionKicker)}>{title}</div>
			<ul className={clsx(styles.list)}>
				{rows.map((row) => (
					<li key={row.id} className={clsx(cardStyles.row)}>
						<input
							type="checkbox"
							className={clsx(board.check, cardStyles.check)}
							aria-label={memoriesCopy.select}
							checked={selected.includes(row.id)}
							onChange={() => onToggle(row.id)}
						/>
						<MemoryButton
							row={row}
							on={picked?.repo === repo && picked.id === row.id}
							onPick={() => onPick({ repo, id: row.id })}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}
