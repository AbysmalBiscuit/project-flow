import type * as stylex from "@stylexjs/stylex";

import { textControl } from "./control-styles.ts";
import { listDetail } from "./list-detail-styles.ts";
import { retroPagePath } from "./page-links.ts";
import type { RetroRow } from "./retros-page.ts";
import { lost, SmoothnessPill, span } from "./retros-parts.tsx";
import { styles } from "./retros-styles.ts";
import { costLabel } from "./run-terms.ts";
import { ticketLabel } from "./ticket-key.ts";
import { clsx } from "./ui.ts";
import { retrosCopy } from "./workflows-terms.ts";

export const pickedRun = (): string | null =>
	new URLSearchParams(window.location.search).get("run");

export function RunsTable({
	runs,
	blank,
	picked,
	onPick,
	empty,
}: {
	runs: RetroRow[];
	blank: number;
	picked: string | null;
	onPick: (id: string) => void;
	empty: string;
}) {
	if (runs.length === 0) {
		return <p className={clsx(styles.empty)}>{empty}</p>;
	}
	const { columns } = retrosCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.ticket}</th>
						<th className={clsx(styles.th)}>{columns.smoothness}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.duration}
						</th>
						<th className={clsx(styles.th, styles.number)}>{columns.rounds}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.friction}
						</th>
						<th className={clsx(styles.th, styles.number)}>{columns.lost}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.cost}</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run, index) => {
						const last = index === runs.length - 1 && blank === 0;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr
								key={run.id}
								className={clsx(
									styles.row,
									run.id === picked && listDetail.rowPicked,
								)}
								onClick={() => onPick(run.id)}
								aria-selected={run.id === picked}
							>
								<td className={cell(styles.nowrap)}>
									<a
										href={retroPagePath(run.id)}
										className={clsx(styles.link, ...textControl)}
										onClick={(event) => event.preventDefault()}
									>
										{ticketLabel(run.ticket)}
									</a>
								</td>
								<td className={cell()}>
									<SmoothnessPill level={run.smoothness} />
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{span(run.durationS)}
								</td>
								<td className={cell(styles.number)}>{run.rounds}</td>
								<td className={cell(styles.number)}>{run.friction}</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{lost(run.timeLostS)}
								</td>
								<td className={cell(styles.number)}>
									{costLabel(run.costUsd)}
								</td>
							</tr>
						);
					})}
					{Array.from({ length: blank }, (_, index) => (
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: blank rows have no identity
							key={index}
							className={clsx(styles.fixedRow)}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}
