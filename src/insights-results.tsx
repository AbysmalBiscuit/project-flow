import * as stylex from "@stylexjs/stylex";

import { control } from "./control-styles.ts";
import { usePaged } from "./factories-paging.tsx";
import type { InsightAnswer, InsightValue } from "./run-history.ts";
import { insightsCopy } from "./terms.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
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
	views: {
		display: "inline-flex",
		gap: space.twoXs,
	},
	view: {
		padding: `${space.sm} ${space.md}`,
		borderWidth: 0,
		borderBottomWidth: measure.focus,
		borderBottomStyle: "solid",
		borderBottomColor: "transparent",
		borderRadius: 0,
		backgroundColor: "transparent",
		color: colours.inkMuted,
		fontFamily: font.sans,
		fontSize: type.menu,
		cursor: "pointer",
	},
	viewOn: {
		borderBottomColor: colours.ink,
		color: colours.ink,
		fontWeight: type.weight,
	},
	meta: {
		marginLeft: "auto",
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	note: {
		margin: `0 0 ${space.sm}`,
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	chart: {
		display: "flex",
		gap: space.lg,
		height: measure.insightResults,
		overflowX: "auto",
		paddingInline: space.sm,
	},
	column: {
		display: "grid",
		gridTemplateRows: "minmax(0, 1fr) auto",
		flex: "1 1 0",
		minWidth: space.xl,
		gap: space.twoXs,
	},
	plot: {
		display: "flex",
		flexDirection: "column",
		justifyContent: "flex-end",
		alignItems: "stretch",
		minHeight: 0,
		gap: space.twoXs,
	},
	value: {
		color: colours.inkMuted,
		fontSize: type.meta,
		textAlign: "center",
		fontVariantNumeric: "tabular-nums",
	},
	bar: (height: string) => ({
		height,
		borderRadius: `${radius.sm} ${radius.sm} 0 0`,
		backgroundColor: colours.accent,
	}),
	label: {
		overflow: "hidden",
		color: colours.inkSoft,
		fontSize: type.lane,
		textAlign: "center",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
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
		padding: `${space.sm} ${space.sm}`,
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
	td: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
		verticalAlign: "middle",
		whiteSpace: "nowrap",
	},
	number: {
		textAlign: "right",
	},
	empty: {
		color: colours.inkSoft,
	},
	answer: {
		display: "flex",
		flexDirection: "column",
		gap: space.twoXs,
	},
	answerName: {
		color: colours.inkSoft,
		fontSize: type.lane,
		letterSpacing: type.headTrack,
		textTransform: "uppercase",
	},
	answerValue: {
		color: colours.ink,
		fontSize: type.bigValue,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
	},
});

export type ResultView = "chart" | "table" | "value";

/** A bar chart fits a result of two columns whose second column holds only numbers. */
function chartable(answer: InsightAnswer): boolean {
	return (
		answer.columns.length === 2 &&
		answer.rows.length > 0 &&
		answer.rows.every((row) => typeof row[1] === "number")
	);
}

function offeredViews(answer: InsightAnswer): ResultView[] {
	const views: ResultView[] = [];
	if (chartable(answer)) {
		views.push("chart");
	}
	views.push("table");
	if (answer.rows.length === 1) {
		views.push("value");
	}
	return views;
}

function defaultView(answer: InsightAnswer): ResultView {
	if (answer.rows.length === 1) {
		return "value";
	}
	return chartable(answer) ? "chart" : "table";
}

function shown(value: InsightValue): string {
	return value === null ? "null" : String(value);
}

const decimals = new Intl.NumberFormat("en", {
	maximumFractionDigits: 4,
	useGrouping: false,
});

const smallDecimals = new Intl.NumberFormat("en", {
	maximumSignificantDigits: 4,
	useGrouping: false,
});

/** A table cell: a non-integer keeps at most 4 decimals, and a value under 1 keeps 4 significant digits. */
function cell(value: InsightValue): string {
	if (typeof value !== "number" || Number.isInteger(value)) {
		return shown(value);
	}
	return (Math.abs(value) < 1 ? smallDecimals : decimals).format(value);
}

function BarChart({ rows }: { rows: InsightValue[][] }) {
	const top = Math.max(...rows.map((row) => Math.abs(Number(row[1]))), 0);
	return (
		<div className={clsx(styles.chart)} role="img" aria-label="Bar chart">
			{rows.map((row, index) => {
				const value = Number(row[1]);
				const share = top === 0 ? 0 : (Math.abs(value) / top) * 85;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: result rows have no identity
						key={index}
						className={clsx(styles.column)}
						title={`${shown(row[0] ?? null)}: ${shown(row[1] ?? null)}`}
					>
						<div className={clsx(styles.plot)}>
							<span className={clsx(styles.value)}>
								{shown(row[1] ?? null)}
							</span>
							<div {...stylex.props(styles.bar(`${share}%`))} />
						</div>
						<span className={clsx(styles.label)}>{shown(row[0] ?? null)}</span>
					</div>
				);
			})}
		</div>
	);
}

function ResultTable({
	columns,
	rows,
}: {
	columns: string[];
	rows: InsightValue[][];
}) {
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						{columns.map((column, index) => (
							<th
								// biome-ignore lint/suspicious/noArrayIndexKey: column names may repeat
								key={index}
								className={clsx(styles.th)}
							>
								{column}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, rowIndex) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: result rows have no identity
						<tr key={rowIndex}>
							{row.map((value, index) => (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: cells have no identity
									key={index}
									className={clsx(
										styles.td,
										typeof value === "number" && styles.number,
										value === null && styles.empty,
									)}
								>
									{cell(value)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function SingleValue({
	columns,
	row,
}: {
	columns: string[];
	row: InsightValue[];
}) {
	const name = columns[columns.length - 1] ?? "";
	const value = row[row.length - 1] ?? null;
	return (
		<div className={clsx(styles.answer)}>
			<span className={clsx(styles.answerName)}>{name}</span>
			<span className={clsx(styles.answerValue)}>{cell(value)}</span>
		</div>
	);
}

/** The result of a query: one card with a Chart, Table or Value switch. */
export function Results({
	answer,
	view,
	onView,
}: {
	answer: InsightAnswer;
	view: ResultView | null;
	onView: (view: ResultView) => void;
}) {
	const paged = usePaged(
		insightsCopy.table,
		answer.rows,
		20,
		answer.columns.join(),
	);
	const offered = offeredViews(answer);
	const shownView =
		view !== null && offered.includes(view) ? view : defaultView(answer);
	return (
		<section aria-label={insightsCopy.views} className={clsx(styles.card)}>
			<div className={clsx(styles.head)}>
				<div
					className={clsx(styles.views)}
					role="tablist"
					aria-label={insightsCopy.views}
				>
					{offered.map((item) => {
						const on = item === shownView;
						return (
							<button
								key={item}
								type="button"
								role="tab"
								aria-selected={on}
								className={clsx(
									styles.view,
									control.focus,
									on && styles.viewOn,
								)}
								onClick={() => onView(item)}
							>
								{insightsCopy[item]}
							</button>
						);
					})}
				</div>
				<span className={clsx(styles.meta)}>
					{insightsCopy.meta(answer.rowCount, answer.ms)}
				</span>
			</div>
			{answer.rows.length === 0 ? (
				<p className={clsx(styles.note)}>{insightsCopy.noRows}</p>
			) : (
				<>
					{answer.truncated ? (
						<p className={clsx(styles.note)}>
							{insightsCopy.cut(answer.rowCount)}
						</p>
					) : null}
					{shownView === "chart" ? <BarChart rows={answer.rows} /> : null}
					{shownView === "table" ? (
						<>
							<ResultTable columns={answer.columns} rows={paged.rows} />
							{paged.pager}
						</>
					) : null}
					{shownView === "value" ? (
						<SingleValue columns={answer.columns} row={answer.rows[0] ?? []} />
					) : null}
				</>
			)}
		</section>
	);
}
