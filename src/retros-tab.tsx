import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { textControl } from "./control-styles.ts";
import { retroPagePath } from "./page-links.ts";
import { pageQuery } from "./queries.ts";
import type {
	FrictionGroup,
	RetroDetail,
	RetroRow,
	RetrosPage,
	RetroStage,
	RunRetro,
	Smoothness,
} from "./retros-page.ts";
import { Segment } from "./segment.tsx";
import { PageFrame } from "./shell.tsx";
import {
	costLabel,
	factoriesCopy,
	navLabel,
	retrosCopy,
	spanText,
} from "./terms.ts";
import { ticketLabel } from "./ticket-key.ts";
import {
	colours,
	font,
	measure,
	media,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	grid: {
		display: "grid",
		gap: space.lg,
		marginBottom: space.lg,
	},
	two: {
		gridTemplateColumns: {
			default: "minmax(0, 2fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
	},
	half: {
		gridTemplateColumns: {
			default: "minmax(0, 1fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
		gap: space.xl,
		marginBottom: 0,
	},
	tiles: {
		gridTemplateColumns: `repeat(auto-fit, minmax(${measure.tileMin}, 1fr))`,
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
		backgroundColor: colours.surfaceMuted,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	sourceStore: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	sourceNeed: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	sourceNext: {
		marginLeft: 0,
	},
	kicker: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	sectionKicker: {
		marginBottom: space.xs,
	},
	tileValue: {
		color: colours.ink,
		fontSize: type.tileValue,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
	},
	pill: {
		display: "inline-flex",
		flexShrink: 0,
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	pillOk: {
		backgroundColor: colours.okWash,
		color: colours.awaitingMerge,
	},
	pillInfo: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	pillWarn: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	pillBad: {
		backgroundColor: colours.dangerWash,
		color: colours.danger,
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
	rowOn: {
		backgroundColor: {
			default: colours.rowOn,
			":hover": colours.rowOn,
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
	},
	nowrap: {
		whiteSpace: "nowrap",
	},
	barCell: {
		width: {
			default: "45%",
			[media.phone]: "30%",
		},
	},
	link: {
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: colours.link,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: "inherit",
		textAlign: "left",
		textDecoration: "none",
	},
	bar: {
		display: "flex",
		height: measure.meterBar,
		overflow: "hidden",
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
	},
	fill: (share: string) => ({
		width: share,
		height: "100%",
		backgroundColor: colours.accent,
	}),
	fillLost: {
		backgroundColor: colours.warn,
	},
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	item: {
		display: "flex",
		gap: space.sm,
		alignItems: "baseline",
		padding: `${space.sm} 0`,
		borderBottomWidth: {
			default: measure.hairline,
			":last-child": 0,
		},
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
	},
	itemBody: {
		minWidth: 0,
		overflowWrap: "anywhere",
	},
	where: {
		flexShrink: 0,
		maxWidth: "50%",
		marginLeft: "auto",
		paddingLeft: space.sm,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.lane,
		overflowWrap: "anywhere",
		textAlign: "right",
	},
	section: {
		marginTop: space.md,
	},
	note: {
		margin: `${space.sm} 0 0`,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
});

const smoothnessTone: Record<Smoothness, stylex.StyleXStyles> = {
	smooth: styles.pillOk,
	bumpy: styles.pillInfo,
	rough: styles.pillWarn,
	stalled: styles.pillBad,
	failed: styles.pillBad,
};

/** A stage shorter than this, with no retry and no lost time, leaves the stage table. */
const shortStageS = 30;

const span = (seconds: number): string => spanText(seconds * 1_000);

/**
 * The time a stage held the run. A question wait counts in the lost time but not in
 * the stage rows, so the larger of the two shows it.
 */
const spent = (stage: RetroStage): number =>
	Math.max(stage.seconds, stage.lostS);

/** Lost time under a minute reads `0m`, as the run lost no whole minute. */
const lost = (seconds: number): string => (seconds < 60 ? "0m" : span(seconds));

const pickedRun = (): string | null =>
	new URLSearchParams(window.location.search).get("run");

function SmoothnessPill({ level }: { level: Smoothness }) {
	return (
		<span className={clsx(styles.pill, smoothnessTone[level])}>{level}</span>
	);
}

function Source({
	children,
	store = false,
	need = false,
	next = false,
}: {
	children: string;
	store?: boolean;
	need?: boolean;
	/** A source after another source in the same head. */
	next?: boolean;
}) {
	return (
		<span
			className={clsx(
				styles.source,
				store && styles.sourceStore,
				need && styles.sourceNeed,
				next && styles.sourceNext,
			)}
		>
			{children}
		</span>
	);
}

/** A retro section that the retro route does not give yet. */
function NoteSection({ title }: { title: string }) {
	return (
		<div className={clsx(styles.section)}>
			<div className={clsx(styles.kicker, styles.sectionKicker)}>{title}</div>
			<p className={clsx(styles.empty)}>{retrosCopy.noNote}</p>
		</div>
	);
}

function Card({
	title,
	head,
	children,
}: {
	title: ReactNode;
	head: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className={clsx(styles.card)}>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{title}</h2>
				{head}
			</div>
			{children}
		</section>
	);
}

function RunsTable({
	runs,
	picked,
	onPick,
	roughOrWorse,
}: {
	runs: RetroRow[];
	picked: string | null;
	onPick: (id: string) => void;
	roughOrWorse: boolean;
}) {
	if (runs.length === 0) {
		return (
			<p className={clsx(styles.empty)}>
				{roughOrWorse ? retrosCopy.noRough : retrosCopy.noRuns}
			</p>
		);
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
						const last = index === runs.length - 1;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr
								key={run.id}
								className={clsx(styles.row, run.id === picked && styles.rowOn)}
							>
								<td className={cell(styles.nowrap)}>
									<a
										href={retroPagePath(run.id)}
										className={clsx(styles.link, ...textControl)}
										onClick={(event) => {
											event.preventDefault();
											onPick(run.id);
										}}
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
				</tbody>
			</table>
		</div>
	);
}

function FrictionGroups({ groups }: { groups: FrictionGroup[] }) {
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

function Tiles({ retro }: { retro: RetroDetail }) {
	const tiles = [
		[retrosCopy.tiles.duration, span(retro.durationS)],
		[retrosCopy.tiles.cost, costLabel(retro.costUsd)],
		[retrosCopy.tiles.rounds, String(retro.rounds)],
		[retrosCopy.tiles.retries, String(retro.retries)],
		[retrosCopy.tiles.lost, lost(retro.timeLostS)],
	] as const;
	return (
		<div className={clsx(styles.grid, styles.tiles)}>
			{tiles.map(([label, value]) => (
				<div key={label}>
					<div className={clsx(styles.kicker)}>{label}</div>
					<div className={clsx(styles.tileValue)}>{value}</div>
				</div>
			))}
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

function RunRetroCard({ runId }: { runId: string }) {
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

function NotServed({ page }: { page: RetrosPage }) {
	return page.notServed.map((factory) => (
		<p key={factory} className={clsx(styles.note)}>
			{factoriesCopy.notServed(factory, retrosCopy.sources.route)}
		</p>
	));
}

export function Page() {
	const [roughOrWorse, setRoughOrWorse] = useState(false);
	const [picked, setPicked] = useState(pickedRun);
	const query = useQuery(pageQuery.retros(roughOrWorse));
	const page = query.data;
	const shown = picked ?? page?.runs[0]?.id ?? null;
	const pick = (id: string) => {
		setPicked(id);
		window.history.replaceState(null, "", retroPagePath(id));
	};
	return (
		<PageFrame title={navLabel.retros} subtitle={retrosCopy.subtitle}>
			{page === undefined ? null : (
				<div className={clsx(styles.grid, styles.two)}>
					<Card
						title={retrosCopy.runs}
						head={
							<>
								<span className={clsx(headerControlStyle.group)}>
									<Segment
										label={retrosCopy.all}
										on={!roughOrWorse}
										onClick={() => setRoughOrWorse(false)}
									/>
									<Segment
										label={retrosCopy.roughOrWorse}
										on={roughOrWorse}
										onClick={() => setRoughOrWorse(true)}
									/>
								</span>
								<Source>{retrosCopy.sources.route}</Source>
							</>
						}
					>
						<RunsTable
							runs={page.runs}
							picked={shown}
							onPick={pick}
							roughOrWorse={roughOrWorse}
						/>
						<NotServed page={page} />
					</Card>
					<Card
						title={retrosCopy.friction}
						head={<Source store>{retrosCopy.sources.aggregate}</Source>}
					>
						<FrictionGroups groups={page.friction} />
					</Card>
				</div>
			)}
			{shown === null ? null : <RunRetroCard runId={shown} />}
		</PageFrame>
	);
}
