import * as stylex from "@stylexjs/stylex";

import { board } from "./board-styles.ts";
import { control } from "./control-styles.ts";
import { openPage, runPagePath } from "./page-links.ts";
import { elapsed, runTime } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import type { RunListRow } from "./run-list.ts";
import { RunDot } from "./run-marks.tsx";
import { RunRemove } from "./run-remove.tsx";
import {
	costLabel,
	hubQueueLabel,
	runRemoveCopy,
	runResultLabel,
	runStatusLabel,
} from "./terms.ts";
import { shortKey } from "./ticket-key.ts";
import { colours, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	status: {
		display: "inline-flex",
		gap: space.xs,
		alignItems: "center",
		whiteSpace: "nowrap",
	},
	nowrap: {
		whiteSpace: "nowrap",
	},
	archived: {
		color: colours.inkMuted,
	},
});

/** One row of the Runs list. A click or Enter on the row opens the run page. */
export function RunRow({ run }: { run: RunListRow }) {
	const open = () => openPage(runPagePath(run.id));
	return (
		<tr
			className={clsx(board.row, control.clear, control.focus)}
			data-run={run.id}
			tabIndex={0}
			onClick={(event) => {
				if (
					event.target instanceof Element &&
					event.target.closest("a, button, dialog") !== null
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
					{run.archivedAt === undefined ? null : (
						<span className={clsx(styles.archived)}>
							{runRemoveCopy.archived}
						</span>
					)}
				</span>
			</td>
			<td className={clsx(board.rowCell, styles.nowrap)}>
				{run.result === undefined ? null : runResultLabel[run.result]}
			</td>
			<td className={clsx(board.rowCell)}>
				<a
					href={runPagePath(run.id)}
					className={clsx(
						board.rowKey,
						control.clear,
						control.bleed,
						control.focus,
					)}
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
			<td className={clsx(board.rowCell, styles.nowrap)}>
				{run.usageTotals === undefined
					? null
					: costLabel(run.usageTotals.costUsd)}
			</td>
			<td className={clsx(board.rowCell)}>
				{run.pull === undefined ? null : (
					<a
						href={run.pull.url}
						target="_blank"
						rel="noreferrer"
						className={clsx(
							panel.factLink,
							control.clear,
							control.bleed,
							control.focus,
						)}
					>
						#{run.pull.number}
					</a>
				)}
			</td>
			<td className={clsx(board.rowCell)}>
				<RunRemove run={run} />
			</td>
		</tr>
	);
}
