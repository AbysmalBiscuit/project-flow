import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "./button.tsx";
import { control } from "./control-styles.ts";
import { pageQuery, useInsightQuery } from "./queries.ts";
import type { InsightAnswer, InsightValue } from "./run-history.ts";
import { PageFrame } from "./shell.tsx";
import { insightsCopy, navLabel } from "./terms.ts";
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

const styles = stylex.create({
	grid: {
		display: "grid",
		gridTemplateColumns: {
			default: `${measure.insightSide} minmax(0, 1fr)`,
			[media.phone]: "minmax(0, 1fr)",
		},
		gap: space.lg,
		alignItems: "start",
		marginTop: space.sm,
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
	kicker: {
		margin: `0 0 ${space.xs}`,
		color: colours.inkSoft,
		fontSize: type.kicker,
		fontWeight: type.regular,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	mono: {
		fontFamily: font.mono,
	},
	tables: {
		margin: 0,
		padding: 0,
		listStyle: "none",
		fontFamily: font.mono,
		fontSize: type.meta,
	},
	tableName: {
		padding: `${space.sm} 0`,
		borderBottomWidth: {
			default: measure.hairline,
			":last-child": 0,
		},
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
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
		backgroundColor: colours.chip,
		color: colours.chipInk,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	editor: {
		display: "block",
		boxSizing: "border-box",
		width: "100%",
		minHeight: measure.insightEditor,
		margin: 0,
		padding: space.md,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.menu,
		backgroundColor: colours.surface,
		color: colours.ink,
		fontFamily: font.mono,
		fontSize: type.small,
		lineHeight: type.line,
		resize: "vertical",
	},
	toolbar: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		margin: `${space.md} 0`,
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
		cursor: {
			default: "pointer",
			":disabled": "not-allowed",
		},
		opacity: {
			default: null,
			":disabled": 0.5,
		},
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
	error: {
		margin: 0,
		color: colours.danger,
		fontFamily: font.mono,
		fontSize: type.small,
		whiteSpace: "pre-wrap",
	},
	chart: {
		display: "flex",
		gap: space.lg,
		height: measure.insightChart,
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
	},
	number: {
		textAlign: "right",
	},
	empty: {
		color: colours.inkSoft,
	},
});

type View = "chart" | "table";

/** A bar chart fits a result of two columns whose second column holds only numbers. */
function chartable(answer: InsightAnswer): boolean {
	return (
		answer.columns.length === 2 &&
		answer.rows.length > 0 &&
		answer.rows.every((row) => typeof row[1] === "number")
	);
}

function shown(value: InsightValue): string {
	return value === null ? "null" : String(value);
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

function ResultTable({ answer }: { answer: InsightAnswer }) {
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						{answer.columns.map((column, index) => (
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
					{answer.rows.map((row, rowIndex) => (
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
									{shown(value)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function Result({ answer, view }: { answer: InsightAnswer; view: View }) {
	if (answer.rows.length === 0) {
		return <p className={clsx(styles.note)}>{insightsCopy.noRows}</p>;
	}
	return (
		<>
			{answer.truncated ? (
				<p className={clsx(styles.note)}>{insightsCopy.cut(answer.rowCount)}</p>
			) : null}
			{view === "chart" && chartable(answer) ? (
				<BarChart rows={answer.rows} />
			) : (
				<ResultTable answer={answer} />
			)}
		</>
	);
}

export function Page() {
	const tables = useQuery(pageQuery.insightTables);
	const query = useInsightQuery();
	const [sql, setSql] = useState<string>(insightsCopy.firstQuery);
	const [view, setView] = useState<View>("chart");
	const run = () => {
		if (sql.trim() !== "") {
			query.mutate(sql);
		}
	};
	// The page opens with the result of its first query.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount
	useEffect(() => {
		query.mutate(insightsCopy.firstQuery);
	}, []);
	const result = query.data;
	const answer = result !== undefined && "rows" in result ? result : null;
	const canChart = answer !== null && chartable(answer);
	return (
		<PageFrame title={navLabel.insights} subtitle={insightsCopy.subtitle}>
			<div className={clsx(styles.grid)}>
				<section className={clsx(styles.card)} aria-label={insightsCopy.tables}>
					<h2 className={clsx(styles.kicker)}>{insightsCopy.tables}</h2>
					<ul className={clsx(styles.tables)}>
						{(tables.data?.tables ?? []).map((table) => (
							<li
								key={table.name}
								className={clsx(styles.tableName)}
								title={table.columns.join(", ")}
							>
								{table.name}
							</li>
						))}
					</ul>
				</section>
				<section className={clsx(styles.card)} aria-label={insightsCopy.query}>
					<div className={clsx(styles.head)}>
						<h2 className={clsx(styles.heading)}>{insightsCopy.query}</h2>
						<span className={clsx(styles.source)}>{insightsCopy.source}</span>
					</div>
					{/* The global stylesheet gives a textarea the font of its parent. */}
					<div className={clsx(styles.mono)}>
						<textarea
							className={clsx(styles.editor, control.focus)}
							aria-label={insightsCopy.editor}
							spellCheck={false}
							value={sql}
							onChange={(event) => setSql(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
									event.preventDefault();
									run();
								}
							}}
						/>
					</div>
					<div className={clsx(styles.toolbar)}>
						<Button
							label={insightsCopy.run}
							onClick={run}
							disabled={query.isPending}
						/>
						<div
							className={clsx(styles.views)}
							role="tablist"
							aria-label={insightsCopy.views}
						>
							{(["chart", "table"] as const).map((item) => {
								const on =
									item === "table"
										? !canChart || view === "table"
										: canChart && view === "chart";
								return (
									<button
										key={item}
										type="button"
										role="tab"
										aria-selected={on}
										disabled={item === "chart" && answer !== null && !canChart}
										title={
											item === "chart" && answer !== null && !canChart
												? insightsCopy.noChart
												: undefined
										}
										className={clsx(
											styles.view,
											control.focus,
											on && styles.viewOn,
										)}
										onClick={() => setView(item)}
									>
										{insightsCopy[item]}
									</button>
								);
							})}
						</div>
						{answer === null ? null : (
							<span className={clsx(styles.meta)}>
								{insightsCopy.meta(answer.rowCount, answer.ms)}
							</span>
						)}
					</div>
					{result !== undefined && "error" in result ? (
						<p className={clsx(styles.error)} role="alert">
							{result.error}
						</p>
					) : null}
					{answer === null ? null : <Result answer={answer} view={view} />}
				</section>
			</div>
		</PageFrame>
	);
}
