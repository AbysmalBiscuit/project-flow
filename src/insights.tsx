import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { control } from "./control-styles.ts";
import {
	pageQuery,
	useInsightQuery,
	useSavedInsightChange,
} from "./queries.ts";
import type { InsightAnswer, InsightValue } from "./run-history.ts";
import type { SavedInsight } from "./saved-insights.ts";
import { PageFrame } from "./shell.tsx";
import { insightsCopy, navLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
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
	section: {
		marginTop: space.md,
	},
	saved: {
		display: "flex",
		flexDirection: "column",
		gap: space.twoXs,
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	savedItem: {
		display: "block",
		boxSizing: "border-box",
		width: "100%",
		padding: `${space.xs} ${space.sm}`,
		borderWidth: 0,
		borderRadius: radius.menu,
		backgroundColor: {
			default: "transparent",
			":hover": colours.segment,
		},
		color: colours.ink,
		fontFamily: font.sans,
		fontSize: type.menu,
		textAlign: "left",
		cursor: "pointer",
	},
	savedOn: {
		backgroundColor: {
			default: colours.chip,
			":hover": colours.chip,
		},
	},
	tableButton: {
		display: "block",
		width: "100%",
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: {
			default: colours.ink,
			":hover": colours.accent,
		},
		fontFamily: font.mono,
		fontSize: type.meta,
		textAlign: "left",
		cursor: "pointer",
	},
	tableOn: {
		fontWeight: type.weight,
	},
	columns: {
		margin: `${space.xs} 0 0`,
		padding: `0 0 0 ${space.md}`,
		listStyle: "none",
		color: colours.inkSoft,
		fontSize: type.lane,
		lineHeight: type.line,
	},
	head: {
		display: "flex",
		flexWrap: "wrap",
		minHeight: measure.control,
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
		whiteSpace: "nowrap",
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

type Dialog = "save" | "rename" | "delete" | null;

export function Page() {
	const tables = useQuery(pageQuery.insightTables);
	const saved = useQuery(pageQuery.savedInsights);
	const query = useInsightQuery();
	const change = useSavedInsightChange();
	const [sql, setSql] = useState("");
	const [view, setView] = useState<View>("chart");
	const [openId, setOpenId] = useState<number | null>(null);
	const [openTable, setOpenTable] = useState<string | null>(null);
	const [dialog, setDialog] = useState<Dialog>(null);
	const [name, setName] = useState("");
	const queries = saved.data?.queries ?? [];
	const open = queries.find((item) => item.id === openId) ?? null;
	const runSql = (text: string) => {
		if (text.trim() !== "") {
			query.mutate(text);
		}
	};
	const openSaved = (item: SavedInsight) => {
		setOpenId(item.id);
		setOpenTable(null);
		setSql(item.sql);
		setView("chart");
		runSql(item.sql);
	};
	const previewTable = (table: string) => {
		const preview = insightsCopy.preview(table);
		setOpenId(null);
		setOpenTable(table);
		setSql(preview);
		setView("table");
		runSql(preview);
	};
	// The page opens on the first saved query, with its result.
	const first = queries[0];
	const [opened, setOpened] = useState(false);
	useEffect(() => {
		if (!opened && first !== undefined) {
			setOpened(true);
			openSaved(first);
		}
	});
	const closeDialog = () => {
		setDialog(null);
		setName("");
	};
	const result = query.data;
	const answer = result !== undefined && "rows" in result ? result : null;
	const canChart = answer !== null && chartable(answer);
	return (
		<PageFrame title={navLabel.insights} subtitle={insightsCopy.subtitle}>
			<div className={clsx(styles.grid)}>
				<div className={clsx(styles.card)}>
					<section aria-label={insightsCopy.savedQueries}>
						<h2 className={clsx(styles.kicker)}>{insightsCopy.savedQueries}</h2>
						{saved.isSuccess && queries.length === 0 ? (
							<p className={clsx(styles.note)}>{insightsCopy.noSaved}</p>
						) : (
							<ul className={clsx(styles.saved)}>
								{queries.map((item) => (
									<li key={item.id}>
										<button
											type="button"
											aria-current={item.id === openId || undefined}
											className={clsx(
												styles.savedItem,
												control.focus,
												item.id === openId && styles.savedOn,
											)}
											onClick={() => openSaved(item)}
										>
											{item.name}
										</button>
									</li>
								))}
							</ul>
						)}
					</section>
					<section
						className={clsx(styles.section)}
						aria-label={insightsCopy.tables}
					>
						<h2 className={clsx(styles.kicker)}>{insightsCopy.tables}</h2>
						<ul className={clsx(styles.tables)}>
							{(tables.data?.tables ?? []).map((table) => (
								<li key={table.name} className={clsx(styles.tableName)}>
									<button
										type="button"
										aria-expanded={table.name === openTable}
										className={clsx(
											styles.tableButton,
											control.focus,
											table.name === openTable && styles.tableOn,
										)}
										onClick={() => previewTable(table.name)}
									>
										{table.name}
									</button>
									{table.name === openTable ? (
										<ul
											className={clsx(styles.columns)}
											aria-label={insightsCopy.columnsOf(table.name)}
										>
											{table.columns.map((column) => (
												<li key={column}>{column}</li>
											))}
										</ul>
									) : null}
								</li>
							))}
						</ul>
					</section>
				</div>
				<section
					className={clsx(styles.card)}
					aria-label={open?.name ?? insightsCopy.query}
				>
					<div className={clsx(styles.head)}>
						<h2 className={clsx(styles.heading)}>
							{open?.name ?? insightsCopy.query}
						</h2>
						{open === null ? null : (
							<>
								<Button
									icon="pencil"
									name={insightsCopy.rename}
									onClick={() => {
										setName(open.name);
										setDialog("rename");
									}}
								/>
								<Button
									icon="trash"
									name={insightsCopy.delete}
									onClick={() => setDialog("delete")}
								/>
							</>
						)}
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
									runSql(sql);
								}
							}}
						/>
					</div>
					<div className={clsx(styles.toolbar)}>
						<Button
							label={insightsCopy.run}
							onClick={() => runSql(sql)}
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
						{open !== null && sql !== open.sql ? (
							<Button
								label={insightsCopy.save}
								disabled={sql.trim() === "" || change.isPending}
								onClick={() =>
									change.mutate({ kind: "change", id: open.id, sql })
								}
							/>
						) : null}
						<Button
							label={insightsCopy.saveAs}
							disabled={sql.trim() === "" || change.isPending}
							onClick={() => setDialog("save")}
						/>
					</div>
					{result !== undefined && "error" in result ? (
						<p className={clsx(styles.error)} role="alert">
							{result.error}
						</p>
					) : null}
					{change.error === null ? null : (
						<p className={clsx(styles.error)} role="alert">
							{change.error.message}
						</p>
					)}
					{answer === null ? null : <Result answer={answer} view={view} />}
				</section>
			</div>
			<ConfirmDialog
				id="insight-name-dialog"
				open={dialog === "save" || dialog === "rename"}
				title={
					dialog === "rename"
						? insightsCopy.renameTitle
						: insightsCopy.saveTitle
				}
				body={
					dialog === "rename" ? insightsCopy.renameBody : insightsCopy.saveBody
				}
				confirmLabel={
					dialog === "rename" ? insightsCopy.rename : insightsCopy.save
				}
				confirmDisabled={name.trim() === ""}
				onCancel={closeDialog}
				onConfirm={() => {
					if (dialog === "rename" && open !== null) {
						change.mutate({ kind: "change", id: open.id, name });
					} else {
						change.mutate(
							{ kind: "create", name, sql },
							{
								onSuccess: (created) => {
									if (created !== null) {
										setOpenId(created.id);
										setOpenTable(null);
									}
								},
							},
						);
					}
					closeDialog();
				}}
			>
				<TextInput
					aria-label={insightsCopy.nameField}
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
			</ConfirmDialog>
			<ConfirmDialog
				id="insight-delete-dialog"
				open={dialog === "delete"}
				title={insightsCopy.deleteTitle}
				body={insightsCopy.deleteBody(open?.name ?? "")}
				confirmLabel={insightsCopy.delete}
				onCancel={closeDialog}
				onConfirm={() => {
					if (open !== null) {
						change.mutate({ kind: "delete", id: open.id });
						setOpenId(null);
					}
					closeDialog();
				}}
			/>
		</PageFrame>
	);
}
