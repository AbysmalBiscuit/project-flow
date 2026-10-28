import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { board } from "./board-styles.ts";
import { control } from "./control-styles.ts";
import { runResults, runStatusKinds } from "./domain.ts";
import { Dropdown, MultiDropdown } from "./dropdown.tsx";
import { Loading } from "./loading.tsx";
import { needs } from "./needs-you-styles.ts";
import { pageQuery } from "./queries.ts";
import type { RunListRow } from "./run-list.ts";
import { RunRow } from "./run-row.tsx";
import { PageFrame } from "./shell.tsx";
import {
	navLabel,
	runResultLabel,
	runsColumnLabel,
	runsListCopy,
	runStatusLabel,
} from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { measure } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	search: {
		flexGrow: 1,
		flexBasis: measure.search,
		maxWidth: measure.panel,
	},
});

const archiveChoices = [
	{ id: "unarchived", label: runsListCopy.unarchived },
	{ id: "archived", label: runsListCopy.archivedOnly },
	{ id: "all", label: runsListCopy.allRuns },
] as const;

type ArchiveView = (typeof archiveChoices)[number]["id"];

function isArchiveView(id: string): id is ArchiveView {
	return archiveChoices.some((choice) => choice.id === id);
}

function inArchiveView(row: RunListRow, view: ArchiveView): boolean {
	return (
		view === "all" || (view === "archived") === (row.archivedAt !== undefined)
	);
}

/** The distinct values of one field, in their first order. */
function choicesOf(rows: RunListRow[], value: (row: RunListRow) => string) {
	return [...new Set(rows.map(value))].map((id) => ({ id, label: id }));
}

/** No picked value lets every row through. */
function picks(picked: readonly string[], value: string | undefined) {
	return picked.length === 0 || (value !== undefined && picked.includes(value));
}

type SortColumn = "start" | "cost";
type SortDirection = "asc" | "desc";

const sortColumns: readonly SortColumn[] = ["start", "cost"];

function isSortColumn(column: string): column is SortColumn {
	return sortColumns.some((item) => item === column);
}

function sortValue(row: RunListRow, column: SortColumn): number | undefined {
	return column === "start"
		? Date.parse(row.startedAt ?? row.submittedAt)
		: row.usageTotals?.costUsd;
}

/** Rows without a value go last in either direction. Ties keep the order of `rows`. */
function sortRuns(
	rows: RunListRow[],
	column: SortColumn,
	direction: SortDirection,
): RunListRow[] {
	return rows.toSorted((left, right) => {
		const leftValue = sortValue(left, column);
		const rightValue = sortValue(right, column);
		if (leftValue === undefined || rightValue === undefined) {
			return (
				(leftValue === undefined ? 1 : 0) - (rightValue === undefined ? 1 : 0)
			);
		}
		return direction === "asc"
			? leftValue - rightValue
			: rightValue - leftValue;
	});
}

function SortMark({ direction }: { direction: SortDirection }) {
	return (
		<svg
			viewBox="0 0 8 8"
			aria-hidden="true"
			className={clsx(board.sortMark, direction === "desc" && board.sortDown)}
		>
			<path d="M1 5.5 4 2.5 7 5.5" fill="none" stroke="currentColor" />
		</svg>
	);
}

function matches(row: RunListRow, search: string): boolean {
	const wanted = search.trim().toLowerCase();
	return (
		wanted === "" ||
		row.key.toLowerCase().includes(wanted) ||
		(row.title?.toLowerCase().includes(wanted) ?? false)
	);
}

function RunsList({ rows }: { rows: RunListRow[] }) {
	const [status, setStatus] = useState<string[]>([]);
	const [result, setResult] = useState<string[]>([]);
	const [project, setProject] = useState<string[]>([]);
	const [factory, setFactory] = useState<string[]>([]);
	const [archive, setArchive] = useState<ArchiveView>("unarchived");
	const [search, setSearch] = useState("");
	const [column, setColumn] = useState<SortColumn>("start");
	const [direction, setDirection] = useState<SortDirection>("desc");
	const filtered = rows.filter(
		(row) =>
			picks(status, row.statusKind) &&
			picks(result, row.result) &&
			picks(project, row.project) &&
			picks(factory, row.factory) &&
			inArchiveView(row, archive) &&
			matches(row, search),
	);
	const shown = sortRuns(filtered, column, direction);
	return (
		<>
			<div className={clsx(needs.toolbar)}>
				<TextInput
					id="runs-search"
					type="search"
					icon="search"
					placeholder={runsListCopy.search}
					aria-label={runsListCopy.search}
					value={search}
					width={styles.search}
					onChange={(event) => setSearch(event.target.value)}
				/>
				<MultiDropdown
					id="runs-status"
					label={runsListCopy.status}
					allLabel={runsListCopy.allStatuses}
					value={status}
					choices={runStatusKinds.map((kind) => ({
						id: kind,
						label: runStatusLabel[kind],
					}))}
					onChange={setStatus}
				/>
				<MultiDropdown
					id="runs-result"
					label={runsListCopy.result}
					allLabel={runsListCopy.allResults}
					value={result}
					choices={runResults.map((kind) => ({
						id: kind,
						label: runResultLabel[kind],
					}))}
					onChange={setResult}
				/>
				<MultiDropdown
					id="runs-project"
					label={runsListCopy.project}
					allLabel={runsListCopy.allProjects}
					value={project}
					choices={choicesOf(rows, (row) => row.project ?? "").filter(
						(choice) => choice.id !== "",
					)}
					onChange={setProject}
				/>
				<MultiDropdown
					id="runs-factory"
					label={runsListCopy.factory}
					allLabel={runsListCopy.allFactories}
					value={factory}
					choices={choicesOf(rows, (row) => row.factory)}
					onChange={setFactory}
				/>
				<Dropdown
					id="runs-archive"
					label={runsListCopy.archive}
					value={archive}
					choices={archiveChoices}
					onChange={(id) => {
						if (isArchiveView(id)) {
							setArchive(id);
						}
					}}
				/>
			</div>
			<div className={clsx(board.grid)}>
				{shown.length === 0 ? (
					<p className={clsx(board.empty)}>
						{rows.length === 0 ? runsListCopy.none : runsListCopy.empty}
					</p>
				) : (
					<table className={clsx(board.rows)}>
						<thead>
							<tr>
								{Object.entries(runsColumnLabel).map(([key, label]) => {
									if (!isSortColumn(key)) {
										return (
											<th
												key={key}
												className={clsx(board.headerCell)}
												scope="col"
											>
												{label}
											</th>
										);
									}
									const active = column === key;
									return (
										<th
											key={key}
											className={clsx(board.headerCell)}
											scope="col"
											aria-sort={
												active
													? direction === "asc"
														? "ascending"
														: "descending"
													: "none"
											}
										>
											<button
												type="button"
												className={clsx(
													board.sort,
													control.clear,
													control.bleed,
													control.focus,
												)}
												data-column={key}
												aria-label={
													active
														? `Sort by ${label}, ${direction === "asc" ? "ascending" : "descending"}`
														: `Sort by ${label}`
												}
												onClick={() => {
													if (active) {
														setDirection(direction === "asc" ? "desc" : "asc");
														return;
													}
													setColumn(key);
													setDirection("desc");
												}}
											>
												{label}
												{active ? <SortMark direction={direction} /> : null}
											</button>
										</th>
									);
								})}
							</tr>
						</thead>
						<tbody>
							{shown.map((row) => (
								<RunRow key={row.id} run={row} />
							))}
						</tbody>
					</table>
				)}
			</div>
		</>
	);
}

/** The Runs list: every workcell run that the factories report. */
export function Page() {
	const { data } = useQuery(pageQuery.runs);
	return (
		<PageFrame title={navLabel.runs} subtitle={runsListCopy.lead}>
			{data === undefined ? <Loading /> : <RunsList rows={data} />}
		</PageFrame>
	);
}
