import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { control } from "./control-styles.ts";
import { Results, type ResultView } from "./insights-results.tsx";
import { PageLoading } from "./loading.tsx";
import { useInsightQuery, useSavedInsightChange } from "./queries-insights.ts";
import { pageQuery } from "./queries-page.ts";
import type { SavedInsight } from "./saved-insights.ts";
import { PageFrame } from "./shell.tsx";
import { SqlEditor } from "./sql-editor.tsx";
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
	stack: {
		display: "flex",
		flexDirection: "column",
		gap: space.lg,
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
	newQuery: {
		display: "flex",
		flexDirection: "column",
		marginBottom: space.md,
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
		flexWrap: "nowrap",
		minHeight: measure.control,
		gap: space.sm,
		alignItems: "center",
		marginBottom: space.md,
	},
	name: {
		boxSizing: "border-box",
		width: "100%",
		minWidth: 0,
		margin: 0,
		padding: space.twoXs,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: {
			default: "transparent",
			":hover": colours.laneLine,
		},
		borderRadius: radius.menu,
		backgroundColor: "transparent",
		color: colours.ink,
		fontFamily: font.sans,
		fontSize: type.heading,
		fontWeight: type.weight,
		"::placeholder": {
			color: colours.inkSoft,
		},
	},
	dirty: {
		color: colours.inkSoft,
		fontSize: type.meta,
		whiteSpace: "nowrap",
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
	toolbar: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		margin: `${space.md} 0`,
	},
	actions: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		marginLeft: "auto",
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
});

type Dialog = "save" | "delete" | null;

export function Page() {
	const tables = useQuery(pageQuery.insightTables);
	const saved = useQuery(pageQuery.savedInsights);
	const query = useInsightQuery();
	const change = useSavedInsightChange();
	const [sql, setSql] = useState("");
	const [view, setView] = useState<ResultView | null>(null);
	const [openId, setOpenId] = useState<number | null>(null);
	const [openTable, setOpenTable] = useState<string | null>(null);
	const [dialog, setDialog] = useState<Dialog>(null);
	const [name, setName] = useState("");
	const [draft, setDraft] = useState("");
	const tableNames = useMemo(
		() => new Set((tables.data?.tables ?? []).map((table) => table.name)),
		[tables.data],
	);
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
		setDraft(item.name);
		setView(null);
		runSql(item.sql);
	};
	const previewTable = (table: string) => {
		const preview = insightsCopy.preview(table);
		setOpenId(null);
		setOpenTable(table);
		setSql(preview);
		setDraft("");
		setView(null);
		runSql(preview);
	};
	const newQuery = () => {
		setOpenId(null);
		setOpenTable(null);
		setSql("");
		setDraft("");
		setView(null);
		query.reset();
	};
	const commitName = () => {
		const next = draft.trim();
		if (open !== null && next !== "" && next !== open.name) {
			change.mutate({ kind: "change", id: open.id, name: next });
		}
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
	if (saved.isPending || tables.isPending) {
		return (
			<PageFrame title={navLabel.insights} subtitle={insightsCopy.subtitle}>
				<PageLoading />
			</PageFrame>
		);
	}
	return (
		<PageFrame title={navLabel.insights} subtitle={insightsCopy.subtitle}>
			<div className={clsx(styles.grid)}>
				<div className={clsx(styles.card)}>
					<div className={clsx(styles.newQuery)}>
						<Button
							tone="strong"
							label={insightsCopy.newQuery}
							onClick={newQuery}
						/>
					</div>
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
				<div className={clsx(styles.stack)}>
					<section
						className={clsx(styles.card)}
						aria-label={open?.name ?? insightsCopy.query}
					>
						<div className={clsx(styles.head)}>
							<input
								className={clsx(styles.name, control.focus)}
								aria-label={insightsCopy.nameField}
								placeholder={insightsCopy.untitled}
								spellCheck={false}
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								onBlur={commitName}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.currentTarget.blur();
									}
								}}
							/>
							{open !== null && sql !== open.sql ? (
								<span className={clsx(styles.dirty)}>
									{insightsCopy.unsaved}
								</span>
							) : null}
							<span className={clsx(styles.source)}>{insightsCopy.source}</span>
						</div>
						<SqlEditor
							value={sql}
							onChange={setSql}
							onRun={() => runSql(sql)}
							tables={tableNames}
							label={insightsCopy.editor}
						/>
						<div className={clsx(styles.toolbar)}>
							<Button
								tone="strong"
								label={insightsCopy.run}
								onClick={() => runSql(sql)}
								disabled={query.isPending}
							/>
							<div className={clsx(styles.actions)}>
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
									onClick={() => {
										setName(draft);
										setDialog("save");
									}}
								/>
								{open !== null ? (
									<Button
										tone="danger"
										label={insightsCopy.deleteQuery}
										onClick={() => setDialog("delete")}
									/>
								) : null}
							</div>
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
					</section>
					{answer === null ? null : (
						<Results answer={answer} view={view} onView={setView} />
					)}
				</div>
			</div>
			<ConfirmDialog
				id="insight-name-dialog"
				open={dialog === "save"}
				title={insightsCopy.saveTitle}
				body={insightsCopy.saveBody}
				confirmLabel={insightsCopy.save}
				confirmDisabled={name.trim() === ""}
				onCancel={closeDialog}
				onConfirm={() => {
					change.mutate(
						{ kind: "create", name, sql },
						{
							onSuccess: (created) => {
								if (created !== null) {
									setOpenId(created.id);
									setOpenTable(null);
									setDraft(created.name);
								}
							},
						},
					);
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
						setDraft("");
					}
					closeDialog();
				}}
			/>
		</PageFrame>
	);
}
