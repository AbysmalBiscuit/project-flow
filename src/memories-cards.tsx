import * as stylex from "@stylexjs/stylex";
import type { MouseEvent, ReactNode } from "react";

import { board } from "./board-styles.ts";
import { listDetail } from "./list-detail-styles.ts";
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
	row: {
		display: "grid",
		gridTemplateColumns: "auto minmax(0, 1fr)",
		alignItems: "start",
		gap: space.sm,
		padding: `${space.sm} ${space.xs}`,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		backgroundColor: {
			default: null,
			":hover": colours.rowHover,
		},
	},
	selectedRow: {
		backgroundColor: colours.rowHover,
	},
	blank: {
		height: measure.listRow,
	},
	check: {
		marginTop: space.twoXs,
	},
	memory: {
		display: "block",
		boxSizing: "border-box",
		minWidth: 0,
		width: "100%",
		margin: 0,
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: colours.ink,
		fontFamily: "inherit",
		textAlign: "left",
		cursor: "pointer",
		outline: {
			default: "none",
			":focus-visible": `${measure.focus} solid ${colours.focus}`,
		},
	},
	meta: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: space.xs,
		marginBottom: space.twoXs,
		color: colours.inkSoft,
		fontSize: type.tag,
	},
	votes: {
		marginLeft: "auto",
		fontVariantNumeric: "tabular-nums",
	},
	text: {
		display: "-webkit-box",
		WebkitLineClamp: 2,
		WebkitBoxOrient: "vertical",
		overflow: "hidden",
		overflowWrap: "anywhere",
		fontSize: type.menu,
	},
});

export type Picked = { repo: string; id: string };

export type MemorySelection = { repo: string; ids: string[] };

export type SelectMode = "toggle" | "range";

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
	repo,
	on,
	onPick,
	onSelect,
}: {
	row: MemoryRow;
	repo: string;
	on: boolean;
	onPick: (picked: Picked) => void;
	onSelect: (id: string, mode: SelectMode) => void;
}) {
	function handleClick(event: MouseEvent<HTMLButtonElement>) {
		if (event.shiftKey) {
			event.preventDefault();
			onSelect(row.id, "range");
		} else if (event.ctrlKey || event.metaKey) {
			onSelect(row.id, "toggle");
		} else {
			onPick({ repo, id: row.id });
		}
	}

	return (
		<button
			type="button"
			aria-pressed={on}
			className={clsx(cardStyles.memory)}
			onMouseDown={(event) => {
				if (event.shiftKey) {
					event.preventDefault();
				}
			}}
			onClick={handleClick}
		>
			<span className={clsx(cardStyles.meta)}>
				<Pill>{row.kind}</Pill>
				<Pill>{row.state}</Pill>
				<span className={clsx(cardStyles.votes)}>
					{memoriesCopy.votes(row.votesFor, row.votesAgainst)}
				</span>
			</span>
			<span className={clsx(cardStyles.text)}>{row.text}</span>
		</button>
	);
}

export function MemoryList({
	rows,
	repo,
	picked,
	selected,
	onPick,
	onSelect,
	blank,
}: {
	rows: MemoryRow[];
	repo: string;
	picked: Picked | null;
	selected: readonly string[];
	onPick: (picked: Picked) => void;
	onSelect: (id: string, mode: SelectMode) => void;
	blank: number;
}) {
	return (
		<ul className={clsx(styles.list)}>
			{rows.map((row) => {
				const on = picked?.repo === repo && picked.id === row.id;
				const chosen = selected.includes(row.id);
				return (
					<li
						key={row.id}
						className={clsx(
							cardStyles.row,
							on && listDetail.rowPicked,
							chosen && !on && cardStyles.selectedRow,
						)}
					>
						<input
							type="checkbox"
							className={clsx(board.check, cardStyles.check)}
							aria-label={memoriesCopy.select}
							checked={chosen}
							onChange={() => onSelect(row.id, "toggle")}
						/>
						<MemoryButton
							row={row}
							repo={repo}
							on={on}
							onPick={onPick}
							onSelect={onSelect}
						/>
					</li>
				);
			})}
			{Array.from({ length: blank }, (_, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: blank rows have no identity
					key={index}
					aria-hidden="true"
					className={clsx(cardStyles.blank)}
				/>
			))}
		</ul>
	);
}
