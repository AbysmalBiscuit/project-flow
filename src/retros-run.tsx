import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";

import { Button } from "./button.tsx";
import { listDetail } from "./list-detail-styles.ts";
import { pageQuery } from "./queries-page.ts";
import type {
	FrictionGroup,
	RetroDetail,
	RetroRow,
	RetroStage,
	RunRetro,
} from "./retros-page.ts";
import { Card, SmoothnessPill, Source, span, Tiles } from "./retros-parts.tsx";
import { styles } from "./retros-styles.ts";
import { ticketLabel } from "./ticket-key.ts";
import { clsx } from "./ui.ts";
import { retrosCopy } from "./workflows-terms.ts";

/** A stage shorter than this, with no retry and no lost time, leaves the stage table. */
const shortStageS = 30;

/**
 * The time a stage held the run. A question wait counts in the lost time but not in
 * the stage rows, so the larger of the two shows it.
 */
const spent = (stage: RetroStage): number =>
	Math.max(stage.seconds, stage.lostS);

/** A retro section that the retro route does not give yet. */
function NoteSection({ title }: { title: string }) {
	return (
		<div className={clsx(styles.section)}>
			<div className={clsx(styles.kicker, styles.sectionKicker)}>{title}</div>
			<p className={clsx(styles.empty)}>{retrosCopy.noNote}</p>
		</div>
	);
}

export function FrictionGroups({
	groups,
	blank,
	runs,
	picked,
	onPick,
	onFilter,
}: {
	groups: FrictionGroup[];
	blank: number;
	runs: RetroRow[];
	picked: string | null;
	onPick: (id: string) => void;
	onFilter: (cause: string) => void;
}) {
	const [openCause, setOpenCause] = useState<string | null>(null);
	if (groups.length === 0) {
		return <p className={clsx(styles.empty)}>{retrosCopy.noFriction}</p>;
	}
	const { columns } = retrosCopy;
	const rowById = new Map(runs.map((row) => [row.id, row]));
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.kind}</th>
						<th className={clsx(styles.th)}>{columns.cause}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.runs}</th>
					</tr>
				</thead>
				<tbody>
					{groups.map((group) => {
						const key = `${group.kind} ${group.cause}`;
						const open = openCause === key;
						return (
							<Fragment key={key}>
								<tr
									className={clsx(styles.row)}
									onClick={() => setOpenCause(open ? null : key)}
								>
									<td className={clsx(styles.td)}>
										<button
											type="button"
											aria-expanded={open}
											className={clsx(styles.link)}
										>
											{open ? "▾" : "▸"}
										</button>{" "}
										<span className={clsx(styles.pill)}>{group.kind}</span>
									</td>
									<td className={clsx(styles.td)}>{group.cause}</td>
									<td className={clsx(styles.td, styles.number)}>
										{group.runs}
									</td>
								</tr>
								{open ? (
									<tr>
										<td colSpan={3} className={clsx(styles.expand)}>
											<div className={clsx(styles.kicker)}>
												{retrosCopy.hitRuns(group.runIds.length)}
											</div>
											<div className={clsx(styles.hits)}>
												{group.runIds.map((id) => {
													const row = rowById.get(id);
													return (
														<button
															key={id}
															type="button"
															className={clsx(
																styles.hit,
																id === picked && listDetail.rowPicked,
															)}
															onClick={() => onPick(id)}
														>
															<span>
																{row === undefined || row.ticket === null
																	? id
																	: ticketLabel(row.ticket)}
															</span>
															{row === undefined ? null : (
																<SmoothnessPill level={row.smoothness} />
															)}
														</button>
													);
												})}
											</div>
											<div className={clsx(styles.section)}>
												<Button
													label={retrosCopy.filterRuns(group.runIds.length)}
													onClick={() => onFilter(group.cause)}
												/>
											</div>
										</td>
									</tr>
								) : null}
							</Fragment>
						);
					})}
					{Array.from({ length: blank }, (_, index) => (
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: blank rows have no identity
							key={index}
							className={clsx(styles.fixedRow)}
						>
							<td className={clsx(styles.td)} />
							<td className={clsx(styles.td)} />
							<td className={clsx(styles.td)} />
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** A stage path that breaks only after a `/` or a `_`, so a narrow table keeps whole words. */
const stageName = (path: string): string => path.replace(/[/_]/g, "$&\u200b");

function StageTable({ retro }: { retro: RetroDetail }) {
	const stages = retro.stages.filter(
		(stage) =>
			stage.seconds >= shortStageS || stage.retries > 0 || stage.lostS > 0,
	);
	if (stages.length === 0) {
		return <p className={clsx(styles.empty)}>{retrosCopy.noStages}</p>;
	}
	const longest = Math.max(...stages.map(spent), 1);
	const { columns } = retrosCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.stage}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.minutes}
						</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.retries}
						</th>
						<th className={clsx(styles.th, styles.barCell)} />
					</tr>
				</thead>
				<tbody>
					{stages.map((stage, index) => {
						const last = index === stages.length - 1;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr key={stage.stage}>
								<td className={cell()}>{stageName(stage.stage)}</td>
								<td className={cell(styles.number)}>
									{Math.round(spent(stage) / 60)}
								</td>
								<td className={cell(styles.number)}>{stage.retries}</td>
								<td className={cell(styles.barCell)}>
									<span className={clsx(styles.bar)}>
										<span
											{...stylex.props(
												styles.fill(`${(spent(stage) / longest) * 100}%`),
												stage.lostS > 0 && styles.fillLost,
											)}
										/>
									</span>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function FrictionPoints({ retro }: { retro: RetroDetail }) {
	if (retro.friction.length === 0) {
		return <p className={clsx(styles.empty)}>{retrosCopy.noPoints}</p>;
	}
	return (
		<ul className={clsx(styles.list)}>
			{retro.friction.map((point) => (
				<li
					key={`${point.at} ${point.kind} ${point.stage}`}
					className={clsx(styles.item)}
				>
					<span className={clsx(styles.pill, styles.pillWarn)}>
						{point.kind}
					</span>
					<span className={clsx(styles.itemBody)}>
						{point.detail || retrosCopy.kindText(point.kind)}
					</span>
					<span className={clsx(styles.where)}>
						{retrosCopy.where(
							point.stage,
							point.timeS > 0 ? span(point.timeS) : null,
						)}
					</span>
				</li>
			))}
		</ul>
	);
}

export function RunRetroCard({
	runId,
	outside,
}: {
	runId: string;
	outside: boolean;
}) {
	const query = useQuery(pageQuery.retrosRun(runId));
	const run: RunRetro | undefined = query.data;
	if (run === undefined) {
		return null;
	}
	return (
		<Card
			title={
				<>
					{run.ticket === null ? runId : ticketLabel(run.ticket)}{" "}
					{run.retro === null ? null : (
						<SmoothnessPill level={run.retro.smoothness} />
					)}
				</>
			}
			head={
				<>
					{outside ? (
						<span className={clsx(styles.pill)}>
							{retrosCopy.outsideFilter}
						</span>
					) : null}
					<Source>{retrosCopy.sources.route}</Source>
					<Source need next>
						{retrosCopy.notesSource}
					</Source>
				</>
			}
		>
			{run.retro === null ? (
				<p className={clsx(styles.empty)}>
					{run.notServed ? retrosCopy.runNotServed : retrosCopy.noRetro}
				</p>
			) : (
				<>
					<Tiles retro={run.retro} />
					<div className={clsx(styles.grid, styles.half)}>
						<div>
							<NoteSection title={retrosCopy.notes.intent} />
							<NoteSection title={retrosCopy.notes.outcome} />
							<div className={clsx(styles.section)}>
								<div className={clsx(styles.kicker, styles.sectionKicker)}>
									{retrosCopy.stages}
								</div>
								<StageTable retro={run.retro} />
							</div>
						</div>
						<div>
							<div className={clsx(styles.section)}>
								<div className={clsx(styles.kicker, styles.sectionKicker)}>
									{retrosCopy.frictionPoints}
								</div>
								<FrictionPoints retro={run.retro} />
							</div>
							<NoteSection title={retrosCopy.notes.learnings} />
							<NoteSection title={retrosCopy.notes.openItems} />
						</div>
					</div>
				</>
			)}
		</Card>
	);
}
