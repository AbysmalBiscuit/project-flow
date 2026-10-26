import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { board } from "./board-styles.ts";
import { runStatusKinds } from "./domain.ts";
import { Dropdown } from "./dropdown.tsx";
import { needs } from "./needs-you-styles.ts";
import { openPage, runPagePath } from "./page-links.ts";
import { elapsed, runTime } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import type { RunListRow } from "./run-list.ts";
import { RunDot } from "./run-marks.tsx";
import { PageFrame } from "./shell.tsx";
import {
	hubQueueLabel,
	loadingLabel,
	navLabel,
	runsColumnLabel,
	runsListCopy,
	runStatusLabel,
} from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { shortKey } from "./ticket-key.ts";
import { measure, space } from "./tokens.stylex.ts";
import { shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	status: {
		display: "inline-flex",
		gap: space.xs,
		alignItems: "center",
		whiteSpace: "nowrap",
	},
	search: {
		flexGrow: 1,
		flexBasis: measure.search,
		maxWidth: measure.panel,
	},
	nowrap: {
		whiteSpace: "nowrap",
	},
});

const all = "all";

/** The distinct values of one field, in their first order. */
function choicesOf(rows: RunListRow[], value: (row: RunListRow) => string) {
	return [...new Set(rows.map(value))].map((id) => ({ id, label: id }));
}

function matches(row: RunListRow, search: string): boolean {
	const wanted = search.trim().toLowerCase();
	return (
		wanted === "" ||
		row.key.toLowerCase().includes(wanted) ||
		(row.title?.toLowerCase().includes(wanted) ?? false)
	);
}

function RunRow({ run }: { run: RunListRow }) {
	const open = () => openPage(runPagePath(run.id));
	return (
		<tr
			className={clsx(board.row)}
			data-run={run.id}
			tabIndex={0}
			onClick={(event) => {
				if (
					event.target instanceof Element &&
					event.target.closest("a") !== null
				) {
					return;
				}
				open();
			}}
			onKeyDown={(event) => {
				if (
					event.target !== event.currentTarget ||
					(event.key !== "Enter" && event.key !== " ")
				) {
					return;
				}
				event.preventDefault();
				open();
			}}
		>
			<td className={clsx(board.rowCell)}>
				<span className={clsx(styles.status)}>
					<RunDot run={run} />
					{runStatusLabel[run.statusKind]}
				</span>
			</td>
			<td className={clsx(board.rowCell)}>
				<a
					href={runPagePath(run.id)}
					className={clsx(board.rowKey, shell.linkFocus)}
				>
					{shortKey(run.key)}
				</a>{" "}
				<span className={clsx(board.rowTitle)}>{run.title}</span>
			</td>
			<td className={clsx(board.rowCell, styles.nowrap)}>{run.project}</td>
			<td className={clsx(board.rowCell)}>{run.stage}</td>
			<td className={clsx(board.rowCell, styles.nowrap)}>{run.factory}</td>
			<td className={clsx(board.rowCell, styles.nowrap)}>
				{run.box ?? hubQueueLabel}
			</td>
			<td className={clsx(board.rowCell, styles.nowrap)}>
				{runTime(run.startedAt)}
			</td>
			<td className={clsx(board.rowCell, styles.nowrap)}>{elapsed(run)}</td>
			<td className={clsx(board.rowCell)}>
				{run.pull === undefined ? null : (
					<a
						href={run.pull.url}
						target="_blank"
						rel="noreferrer"
						className={clsx(panel.factLink, shell.linkFocus)}
					>
						#{run.pull.number}
					</a>
				)}
			</td>
		</tr>
	);
}

function RunsList({ rows }: { rows: RunListRow[] }) {
	const [status, setStatus] = useState(all);
	const [project, setProject] = useState(all);
	const [factory, setFactory] = useState(all);
	const [search, setSearch] = useState("");
	const shown = rows.filter(
		(row) =>
			(status === all || row.statusKind === status) &&
			(project === all || row.project === project) &&
			(factory === all || row.factory === factory) &&
			matches(row, search),
	);
	return (
		<>
			<div className={clsx(needs.toolbar)}>
				<Dropdown
					id="runs-status"
					label={runsListCopy.status}
					value={status}
					choices={[
						{ id: all, label: runsListCopy.allStatuses },
						...runStatusKinds.map((kind) => ({
							id: kind,
							label: runStatusLabel[kind],
						})),
					]}
					onChange={setStatus}
				/>
				<Dropdown
					id="runs-project"
					label={runsListCopy.project}
					value={project}
					choices={[
						{ id: all, label: runsListCopy.allProjects },
						...choicesOf(rows, (row) => row.project ?? "").filter(
							(choice) => choice.id !== "",
						),
					]}
					onChange={setProject}
				/>
				<Dropdown
					id="runs-factory"
					label={runsListCopy.factory}
					value={factory}
					choices={[
						{ id: all, label: runsListCopy.allFactories },
						...choicesOf(rows, (row) => row.factory),
					]}
					onChange={setFactory}
				/>
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
								{Object.entries(runsColumnLabel).map(([key, label]) => (
									<th key={key} className={clsx(board.headerCell)} scope="col">
										{label}
									</th>
								))}
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
		<PageFrame title={navLabel.runs} subtitle={runsListCopy.lead} wide>
			{data === undefined ? (
				<p className={clsx(board.empty)}>{loadingLabel}</p>
			) : (
				<RunsList rows={data} />
			)}
		</PageFrame>
	);
}
