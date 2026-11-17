import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import { pageQuery } from "./queries-page.ts";
import type {
	FrictionGroup,
	RetroDetail,
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

export function FrictionGroups({ groups }: { groups: FrictionGroup[] }) {
	if (groups.length === 0) {
		return <p className={clsx(styles.empty)}>{retrosCopy.noFriction}</p>;
	}
	return (
		<ul className={clsx(styles.list)}>
			{groups.map((group) => (
				<li key={`${group.kind} ${group.cause}`} className={clsx(styles.item)}>
					<span className={clsx(styles.pill)}>{group.kind}</span>
					<span className={clsx(styles.itemBody)}>{group.cause}</span>
					<span className={clsx(styles.where)}>
						{retrosCopy.runCount(group.runs)}
					</span>
				</li>
			))}
		</ul>
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

export function RunRetroCard({ runId }: { runId: string }) {
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
