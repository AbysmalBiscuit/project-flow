import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";

import { textControl } from "./control-styles.ts";
import { runPagePath } from "./page-links.ts";
import { roleInkOf } from "./run-graph-outline.tsx";
import { runResultLabel } from "./terms.ts";
import { ticketLabel } from "./ticket-key.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { type Column, resultDot } from "./workflows-cards.tsx";
import type {
	WorkflowRole,
	WorkflowRun,
	WorkflowStage,
} from "./workflows-page.ts";
import { styles } from "./workflows-styles.ts";
import { workflowsCopy } from "./workflows-terms.ts";

const tablesStyles = stylex.create({
	rolePill: {
		display: "inline-flex",
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	mono: {
		fontFamily: font.mono,
		fontSize: type.small,
		whiteSpace: "nowrap",
	},
	paneHead: {
		display: "flex",
		justifyContent: "flex-end",
		gap: space.xs,
		marginBottom: space.sm,
	},
	sourceRoute: {
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
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
		whiteSpace: "nowrap",
	},
	wrap: {
		overflowWrap: "anywhere",
	},
	link: {
		color: colours.link,
		textDecoration: "none",
	},
	dot: {
		display: "inline-block",
		width: measure.meterBar,
		height: measure.meterBar,
		borderRadius: radius.pill,
		backgroundColor: colours.inkSoft,
	},
});

function Table<K extends string>({
	columns,
	rows,
}: {
	columns: readonly Column<K>[];
	rows: { key: string; cells: Record<K, ReactNode> }[];
}) {
	return (
		<div className={clsx(tablesStyles.scroll)}>
			<table className={clsx(tablesStyles.table)}>
				<thead>
					<tr>
						{columns.map((column) => (
							<th
								key={column.key}
								className={clsx(
									tablesStyles.th,
									column.number === true && tablesStyles.number,
								)}
							>
								{column.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr key={row.key} className={clsx(tablesStyles.row)}>
							{columns.map((column) => (
								<td
									key={column.key}
									className={clsx(
										tablesStyles.td,
										index === rows.length - 1 && tablesStyles.lastRow,
										column.number === true
											? tablesStyles.number
											: tablesStyles.wrap,
									)}
								>
									{row.cells[column.key]}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The stages that the table shows until Lev asks for all of them. */
const shortStageList = 10;

export function StagesTable({ stages }: { stages: WorkflowStage[] }) {
	const [all, setAll] = useState(false);
	if (stages.length === 0) {
		return <p className={clsx(styles.empty)}>{workflowsCopy.noStages}</p>;
	}
	const { columns } = workflowsCopy;
	return (
		<>
			<Table
				columns={[
					{ key: "stage", label: columns.stage },
					{ key: "visits", label: columns.visits, number: true },
					{ key: "failRate", label: columns.failRate, number: true },
					{ key: "p50", label: columns.p50, number: true },
					{ key: "p95", label: columns.p95, number: true },
					{ key: "tokens", label: columns.tokens, number: true },
					{ key: "cost", label: columns.cost, number: true },
				]}
				rows={(all ? stages : stages.slice(0, shortStageList)).map((stage) => ({
					key: stage.stage,
					cells: {
						stage: stage.stage,
						visits: workflowsCopy.visits(stage.visitsPerRun),
						failRate: workflowsCopy.share(stage.failRate),
						p50: workflowsCopy.seconds(stage.p50S),
						p95: workflowsCopy.seconds(stage.p95S),
						tokens:
							stage.tokensPerRun === null
								? workflowsCopy.none
								: workflowsCopy.tokens(stage.tokensPerRun),
						cost: workflowsCopy.cost(stage.costPerRun),
					},
				}))}
			/>
			{stages.length > shortStageList ? (
				<p className={clsx(styles.more)}>
					<button
						type="button"
						className={clsx(styles.moreButton, ...textControl)}
						aria-expanded={all}
						onClick={() => setAll(!all)}
					>
						{all
							? workflowsCopy.fewerStages
							: workflowsCopy.allStages(stages.length)}
					</button>
				</p>
			) : null}
		</>
	);
}

export function RunsTable({ runs }: { runs: WorkflowRun[] }) {
	if (runs.length === 0) {
		return <p className={clsx(styles.empty)}>{workflowsCopy.noRuns}</p>;
	}
	const { columns } = workflowsCopy;
	return (
		<Table
			columns={[
				{ key: "result", label: "" },
				{ key: "ticket", label: columns.ticket },
				{ key: "factory", label: columns.factory },
				{ key: "duration", label: columns.duration, number: true },
				{ key: "rounds", label: columns.rounds, number: true },
				{ key: "pr", label: columns.pr },
				{ key: "cost", label: columns.runCost, number: true },
			]}
			rows={runs.map((run) => ({
				key: run.id,
				cells: {
					result: (
						<span
							role="img"
							aria-label={
								run.result === undefined
									? run.status
									: runResultLabel[run.result]
							}
							className={clsx(
								tablesStyles.dot,
								run.result !== undefined && resultDot[run.result],
							)}
						/>
					),
					ticket: (
						<a
							href={runPagePath(run.id)}
							className={clsx(tablesStyles.link, ...textControl)}
						>
							{ticketLabel(run.key)}
						</a>
					),
					factory: run.factory,
					duration: workflowsCopy.seconds(run.durationS),
					rounds: run.rounds ?? workflowsCopy.none,
					pr:
						run.pull === undefined ? (
							workflowsCopy.none
						) : (
							<a
								href={run.pull.url}
								target="_blank"
								rel="noreferrer"
								className={clsx(tablesStyles.link, ...textControl)}
							>
								{`#${run.pull.number}`}
							</a>
						),
					cost: workflowsCopy.cost(run.costUsd),
				},
			}))}
		/>
	);
}

export function RolesTable({ roles }: { roles: WorkflowRole[] }) {
	const { columns } = workflowsCopy;
	return (
		<>
			<div className={clsx(tablesStyles.paneHead)}>
				<span className={clsx(styles.source, tablesStyles.sourceRoute)}>
					{workflowsCopy.packageRoute}
				</span>
				<span className={clsx(styles.source, styles.sourceOwn)}>
					{workflowsCopy.source}
				</span>
			</div>
			{roles.length === 0 ? (
				<p className={clsx(styles.empty)}>{workflowsCopy.noRoles}</p>
			) : (
				<Table
					columns={[
						{ key: "role", label: columns.role },
						{ key: "harness", label: columns.harness },
						{ key: "model", label: columns.model },
						{ key: "stages", label: columns.stages },
						{ key: "share", label: columns.costShare, number: true },
					]}
					rows={roles.map((role) => ({
						key: role.role,
						cells: {
							role: (
								<span
									className={clsx(tablesStyles.rolePill, roleInkOf(role.role))}
								>
									{role.role}
								</span>
							),
							harness: (
								<span className={clsx(tablesStyles.mono)}>
									{role.harnesses.join(", ") || workflowsCopy.none}
								</span>
							),
							model: (
								<span className={clsx(tablesStyles.mono)}>
									{role.models.join(", ") || workflowsCopy.none}
								</span>
							),
							stages: role.stages.join(", ") || workflowsCopy.none,
							share:
								role.costShare === null
									? workflowsCopy.none
									: workflowsCopy.share(role.costShare),
						},
					}))}
				/>
			)}
		</>
	);
}
