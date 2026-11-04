import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

import { textControl } from "./control-styles.ts";
import type { RunResult } from "./kinds.ts";
import { runPagePath } from "./page-links.ts";
import { pageQuery } from "./queries.ts";
import { WorkflowDiagram } from "./run-graph.tsx";
import { PageFrame } from "./shell.tsx";
import {
	costLabel,
	navLabel,
	runResultLabel,
	spanText,
	workflowsCopy,
} from "./terms.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import type {
	WorkflowCard,
	WorkflowDetail,
	WorkflowRun,
	WorkflowStage,
} from "./workflows-page.ts";

const styles = stylex.create({
	cards: {
		display: "grid",
		gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${measure.workflowCardMin}), 1fr))`,
		gap: space.lg,
		marginBottom: space.lg,
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
	pick: {
		display: "block",
		width: "100%",
		color: colours.ink,
		font: "inherit",
		textAlign: "left",
		cursor: "pointer",
		outlineWidth: measure.focus,
		outlineStyle: {
			default: "none",
			":focus-visible": "solid",
		},
		outlineColor: colours.focus,
	},
	picked: {
		outlineStyle: "solid",
		outlineColor: colours.accent,
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
	pill: {
		display: "inline-flex",
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontFamily: font.mono,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	meta: {
		marginLeft: "auto",
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	stats: {
		display: "flex",
		flexWrap: "wrap",
		gap: measure.statGap,
	},
	stat: {
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	statValue: {
		display: "block",
		color: colours.ink,
		fontSize: type.body,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
	},
	source: {
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	sourceOwn: {
		marginLeft: "auto",
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	sourceNeed: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	tabs: {
		display: "flex",
		gap: space.twoXs,
		marginBottom: space.md,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
	},
	tab: {
		padding: `${space.xs} ${space.sm}`,
		borderWidth: 0,
		borderBottomWidth: measure.focus,
		borderBottomStyle: "solid",
		borderBottomColor: "transparent",
		backgroundColor: "transparent",
		color: colours.inkMuted,
		font: "inherit",
		fontSize: type.menu,
		cursor: "pointer",
	},
	tabOn: {
		borderBottomColor: colours.ink,
		color: colours.ink,
		fontWeight: type.weight,
	},
	note: {
		margin: `0 0 ${space.sm}`,
		color: colours.inkSoft,
		fontSize: type.small,
		textAlign: "right",
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
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
	more: {
		margin: `calc(-1 * ${space.sm}) 0 ${space.lg}`,
	},
	moreButton: {
		borderWidth: 0,
		color: colours.link,
		font: "inherit",
		fontSize: type.small,
		cursor: "pointer",
	},
	dot: {
		display: "inline-block",
		width: measure.meterBar,
		height: measure.meterBar,
		borderRadius: radius.pill,
		backgroundColor: colours.inkSoft,
	},
});

const resultDot: Record<RunResult, stylex.StyleXStyles> = stylex.create({
	merged: { backgroundColor: colours.awaitingMerge },
	prOpen: { backgroundColor: colours.accent },
	noPr: { backgroundColor: colours.inkSoft },
	failed: { backgroundColor: colours.danger },
	cancelled: { backgroundColor: colours.lineStrong },
});

const tabs = ["diagram", "stages", "runs"] as const;

/** The versions with the latest runs, one row of cards on a desktop. The older ones fold. */
const newestShown = 3;

type Tab = (typeof tabs)[number];

const shortSha = (sha: string) => sha.slice(0, 7);

const versionKey = (card: Pick<WorkflowCard, "package" | "sha">) =>
	JSON.stringify([card.package, card.sha]);

const seconds = (value: number | null) =>
	value === null ? workflowsCopy.none : spanText(value * 1_000);

const cost = (value: number | null) =>
	value === null ? workflowsCopy.none : costLabel(value);

/** The clock time, once a minute, so the "last run" ages stay current. */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

function Sha({
	sha,
	prefix = false,
}: {
	sha: string | null;
	prefix?: boolean;
}) {
	const text =
		sha === null
			? workflowsCopy.noSha
			: prefix
				? workflowsCopy.sha(shortSha(sha))
				: shortSha(sha);
	return (
		<span className={clsx(styles.pill)} title={sha ?? undefined}>
			{text}
		</span>
	);
}

function Stat({ value, label }: { value: string; label: string }) {
	return (
		<div className={clsx(styles.stat)}>
			<b className={clsx(styles.statValue)}>{value}</b>
			{label}
		</div>
	);
}

function Card({
	card,
	picked,
	now,
	onPick,
}: {
	card: WorkflowCard;
	picked: boolean;
	now: number;
	onPick: () => void;
}) {
	const { stats } = workflowsCopy;
	return (
		<button
			type="button"
			className={clsx(styles.card, styles.pick, picked && styles.picked)}
			aria-pressed={picked}
			onClick={onPick}
		>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{card.package}</h2>
				<Sha sha={card.sha} />
				<span className={clsx(styles.meta)}>
					{workflowsCopy.lastRun(spanText(now - Date.parse(card.lastRunAt)))}
				</span>
			</div>
			<div className={clsx(styles.stats)}>
				<Stat value={String(card.runs)} label={stats.runs} />
				<Stat
					value={
						card.mergeRate === null
							? workflowsCopy.none
							: workflowsCopy.share(card.mergeRate)
					}
					label={stats.merged}
				/>
				<Stat value={seconds(card.medianS)} label={stats.median} />
				<Stat value={cost(card.costPerRun)} label={stats.perRun} />
			</div>
		</button>
	);
}

type Column<K extends string> = { key: K; label: string; number?: boolean };

function Table<K extends string>({
	columns,
	rows,
}: {
	columns: readonly Column<K>[];
	rows: { key: string; cells: Record<K, ReactNode> }[];
}) {
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						{columns.map((column) => (
							<th
								key={column.key}
								className={clsx(
									styles.th,
									column.number === true && styles.number,
								)}
							>
								{column.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr key={row.key} className={clsx(styles.row)}>
							{columns.map((column) => (
								<td
									key={column.key}
									className={clsx(
										styles.td,
										index === rows.length - 1 && styles.lastRow,
										column.number === true ? styles.number : styles.wrap,
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

function StagesTable({ stages }: { stages: WorkflowStage[] }) {
	if (stages.length === 0) {
		return <p className={clsx(styles.empty)}>{workflowsCopy.noStages}</p>;
	}
	const { columns } = workflowsCopy;
	return (
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
			rows={stages.map((stage) => ({
				key: stage.stage,
				cells: {
					stage: stage.stage,
					visits: workflowsCopy.visits(stage.visitsPerRun),
					failRate: workflowsCopy.share(stage.failRate),
					p50: seconds(stage.p50S),
					p95: seconds(stage.p95S),
					tokens:
						stage.tokensPerRun === null
							? workflowsCopy.none
							: workflowsCopy.tokens(stage.tokensPerRun),
					cost: cost(stage.costPerRun),
				},
			}))}
		/>
	);
}

function RunsTable({ runs }: { runs: WorkflowRun[] }) {
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
								styles.dot,
								run.result !== undefined && resultDot[run.result],
							)}
						/>
					),
					ticket: (
						<a
							href={runPagePath(run.id)}
							className={clsx(styles.link, ...textControl)}
						>
							{run.key}
						</a>
					),
					factory: run.factory,
					duration: seconds(run.durationS),
					rounds: run.rounds ?? workflowsCopy.none,
					pr:
						run.pull === undefined ? (
							workflowsCopy.none
						) : (
							<a
								href={run.pull.url}
								target="_blank"
								rel="noreferrer"
								className={clsx(styles.link, ...textControl)}
							>
								{`#${run.pull.number}`}
							</a>
						),
					cost: cost(run.costUsd),
				},
			}))}
		/>
	);
}

function Diagram({ graph }: { graph: WorkflowDetail["graph"] }) {
	if (graph === null) {
		return <p className={clsx(styles.empty)}>{workflowsCopy.noGraph}</p>;
	}
	return (
		<>
			<p className={clsx(styles.note)}>{workflowsCopy.diagramNote}</p>
			<WorkflowDiagram key={graph.runId} graph={graph.graph} />
		</>
	);
}

function Detail({ card }: { card: WorkflowCard }) {
	const [tab, setTab] = useState<Tab>("diagram");
	const detail = useQuery(pageQuery.workflow(card.package, card.sha)).data;
	return (
		<section className={clsx(styles.card)} aria-label={card.package}>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{card.package}</h2>
				<Sha sha={card.sha} prefix />
				<span className={clsx(styles.source, styles.sourceOwn)}>
					{workflowsCopy.source}
				</span>
				<span className={clsx(styles.source, styles.sourceNeed)}>
					{workflowsCopy.needsPackages}
				</span>
			</div>
			<div
				className={clsx(styles.tabs)}
				role="tablist"
				aria-label={workflowsCopy.tabsLabel}
			>
				{tabs.map((item) => (
					<button
						key={item}
						type="button"
						role="tab"
						aria-selected={item === tab}
						className={clsx(styles.tab, item === tab && styles.tabOn)}
						onClick={() => setTab(item)}
					>
						{workflowsCopy.tabs[item]}
					</button>
				))}
			</div>
			{detail === undefined ? null : tab === "diagram" ? (
				<Diagram graph={detail.graph} />
			) : tab === "stages" ? (
				<StagesTable stages={detail.stages} />
			) : (
				<RunsTable runs={detail.runs} />
			)}
		</section>
	);
}

export function Page() {
	const cards = useQuery(pageQuery.workflows).data?.cards;
	const now = useNow();
	const [picked, setPicked] = useState<string | null>(null);
	const [older, setOlder] = useState(false);
	const card = cards?.find((item) => versionKey(item) === picked) ?? cards?.[0];
	const hidden = Math.max(0, (cards?.length ?? 0) - newestShown);
	return (
		<PageFrame title={navLabel.workflows} subtitle={workflowsCopy.subtitle}>
			{cards === undefined ? null : cards.length === 0 ? (
				<p className={clsx(styles.empty)}>{workflowsCopy.empty}</p>
			) : (
				<>
					<div className={clsx(styles.cards)}>
						{(older ? cards : cards.slice(0, newestShown)).map((item) => (
							<Card
								key={versionKey(item)}
								card={item}
								picked={
									card !== undefined && versionKey(card) === versionKey(item)
								}
								now={now}
								onPick={() => setPicked(versionKey(item))}
							/>
						))}
					</div>
					{hidden === 0 ? null : (
						<p className={clsx(styles.more)}>
							<button
								type="button"
								className={clsx(styles.moreButton, ...textControl)}
								aria-expanded={older}
								onClick={() => setOlder(!older)}
							>
								{older
									? workflowsCopy.hideOlder
									: workflowsCopy.showOlder(hidden)}
							</button>
						</p>
					)}
					{card === undefined ? null : <Detail card={card} />}
				</>
			)}
		</PageFrame>
	);
}
