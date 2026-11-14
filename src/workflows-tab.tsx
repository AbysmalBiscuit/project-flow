import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";

import { textControl } from "./control-styles.ts";
import type { RunResult } from "./kinds.ts";
import { runPagePath } from "./page-links.ts";
import { pageQuery } from "./queries.ts";
import { roleInkOf, WorkflowDiagram } from "./run-graph.tsx";
import { PageFrame } from "./shell.tsx";
import { navLabel, runResultLabel, spanText, workflowsCopy } from "./terms.ts";
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
import { clsx } from "./ui.ts";
import { useNow } from "./use-now.ts";
import { WorkflowStagePane } from "./workflow-stage-pane.tsx";
import type {
	WorkflowCard,
	WorkflowDetail,
	WorkflowRole,
	WorkflowRun,
	WorkflowStage,
} from "./workflows-page.ts";

const styles = stylex.create({
	cards: {
		display: "grid",
		// At most three cards per row, and fewer when a card would get narrower than its minimum.
		gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, max(${measure.workflowCardMin}, calc((100% - 2 * ${space.lg}) / 3))), 1fr))`,
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
	meta: {
		marginLeft: "auto",
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	since: {
		color: colours.inkSoft,
		fontSize: type.meta,
		whiteSpace: "nowrap",
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
	sourceFirst: {
		marginLeft: "auto",
	},
	sourceRoute: {
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
	},
	sourceOwn: {
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
		flexGrow: 1,
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
		textAlign: {
			default: "right",
			[media.headerStack]: "left",
		},
	},
	diagramHead: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "flex-start",
		gap: space.sm,
		marginBottom: space.sm,
	},
	chips: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	chipItem: {
		display: "flex",
	},
	chipMain: {
		borderColor: colours.ink,
	},
	chipNote: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		fontWeight: "normal",
	},
	chip: {
		display: "flex",
		flexDirection: "column",
		alignItems: "flex-start",
		padding: `${space.xs} ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: "transparent",
		color: colours.ink,
		font: "inherit",
		fontSize: type.small,
		cursor: "pointer",
	},
	chipOn: {
		backgroundColor: colours.chip,
		fontWeight: type.weight,
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

const tabs = ["diagram", "stages", "roles", "runs"] as const;

/** The versions with the latest runs, one row of cards on a desktop. The older ones fold, and a version with no run stays. */
const newestShown = 3;

type Tab = (typeof tabs)[number];

const shortSha = (sha: string) => sha.slice(0, 7);

const versionKey = (card: Pick<WorkflowCard, "package" | "sha">) =>
	JSON.stringify([card.package, card.sha]);

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

/** Since when a version runs: the start of its first run in the run history. */
function Since({ card }: { card: WorkflowCard }) {
	return card.firstRunAt === null ? null : (
		<span className={clsx(styles.since)}>
			{workflowsCopy.since(card.firstRunAt)}
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
	reading,
	picked,
	now,
	onPick,
}: {
	card: WorkflowCard;
	reading: boolean;
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
				<Since card={card} />
				<span className={clsx(styles.meta)}>
					{card.lastRunAt === null
						? workflowsCopy.noRunYet
						: workflowsCopy.lastRun(spanText(now - Date.parse(card.lastRunAt)))}
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
					label={reading ? stats.mergedReading : stats.merged}
				/>
				<Stat
					value={workflowsCopy.seconds(card.medianS)}
					label={stats.median}
				/>
				<Stat
					value={workflowsCopy.cost(card.costPerRun)}
					label={stats.perRun}
				/>
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

/** The stages that the table shows until Lev asks for all of them. */
const shortStageList = 10;

function StagesTable({ stages }: { stages: WorkflowStage[] }) {
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
								className={clsx(styles.link, ...textControl)}
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

function RolesTable({ roles }: { roles: WorkflowRole[] }) {
	const { columns } = workflowsCopy;
	return (
		<>
			<div className={clsx(styles.paneHead)}>
				<span className={clsx(styles.source, styles.sourceRoute)}>
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
								<span className={clsx(styles.rolePill, roleInkOf(role.role))}>
									{role.role}
								</span>
							),
							harness: (
								<span className={clsx(styles.mono)}>
									{role.harnesses.join(", ") || workflowsCopy.none}
								</span>
							),
							model: (
								<span className={clsx(styles.mono)}>
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

type ShownGraphs = NonNullable<WorkflowDetail["graph"]>["graphs"];

type Caller = ShownGraphs[number]["calledBy"][number];

const stageLabel = (graphs: ShownGraphs, caller: Caller): string =>
	graphs
		.find((item) => item.name === caller.graph)
		?.graph.nodes.find((node) => node.id === caller.stage)?.label ??
	caller.stage;

/** The note under a graph name: the main flow, the first stage that calls it, or no caller. */
function callerNote(item: ShownGraphs[number], graphs: ShownGraphs): string {
	const [first, ...more] = item.calledBy;
	if (item.entry) {
		return workflowsCopy.mainFlow;
	}
	if (first === undefined) {
		return workflowsCopy.noCaller;
	}
	return workflowsCopy.calledBy(stageLabel(graphs, first), more.length);
}

function Diagram({ detail }: { detail: WorkflowDetail }) {
	const { graph } = detail;
	const [picked, setPicked] = useState<string | null>(null);
	const [stage, setStage] = useState<{ graph: string; id: string } | null>(
		null,
	);
	const shown =
		graph?.graphs.find((item) => item.name === picked) ?? graph?.graphs[0];
	const calls = useMemo(
		() =>
			new Map(
				(graph?.graphs ?? []).flatMap((item) =>
					item.calledBy
						.filter((caller) => caller.graph === shown?.name)
						.map((caller) => [caller.stage, item.name] as const),
				),
			),
		[graph, shown],
	);
	if (graph === null || shown === undefined) {
		return <p className={clsx(styles.empty)}>{workflowsCopy.noGraph}</p>;
	}
	const nodes = shown.graph.nodes;
	const node =
		stage === null || stage.graph !== shown.name
			? undefined
			: (nodes.find((item) => item.id === stage.id) ??
				nodes.find((item) => item.id === stage.id.split("/")[0]));
	return (
		<>
			<div className={clsx(styles.diagramHead)}>
				<ol
					className={clsx(styles.chips)}
					aria-label={workflowsCopy.graphsLabel}
				>
					{graph.graphs.map((item) => (
						<li key={item.name} className={clsx(styles.chipItem)}>
							<button
								type="button"
								aria-pressed={item === shown}
								className={clsx(
									styles.chip,
									item.entry && styles.chipMain,
									item === shown && styles.chipOn,
								)}
								title={item.calledBy
									.map(
										(caller) =>
											`${caller.graph} › ${stageLabel(graph.graphs, caller)}`,
									)
									.join("\n")}
								onClick={() => setPicked(item.name)}
							>
								<span>{item.name}</span>
								<span className={clsx(styles.chipNote)}>
									{callerNote(item, graph.graphs)}
								</span>
							</button>
						</li>
					))}
				</ol>
				<p className={clsx(styles.note)}>
					{workflowsCopy.diagramNote(graph.runId !== undefined)}
				</p>
			</div>
			<WorkflowDiagram
				key={`${graph.runId ?? ""}\n${shown.name}`}
				graph={shown.graph}
				diagram={{
					calls,
					onOpen: setPicked,
					onPick: (id) => setStage({ graph: shown.name, id }),
				}}
				aside={
					node === undefined ? null : (
						<WorkflowStagePane
							graph={shown.graph}
							stage={node}
							stats={
								shown.entry
									? detail.stages.find((item) => item.stage === node.id)
									: undefined
							}
							role={detail.roles?.find((item) => item.role === node.role)}
							opens={calls.get(node.id) ?? null}
							onOpen={setPicked}
							onClose={() => setStage(null)}
						/>
					)
				}
			/>
		</>
	);
}

function Detail({ card }: { card: WorkflowCard }) {
	const [picked, setTab] = useState<Tab>("diagram");
	const detail = useQuery(pageQuery.workflow(card.package, card.sha)).data;
	const roles = detail?.roles ?? null;
	const shownTabs = tabs.filter((item) => item !== "roles" || roles !== null);
	const tab = shownTabs.includes(picked) ? picked : "diagram";
	return (
		<section className={clsx(styles.card)} aria-label={card.package}>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{card.package}</h2>
				<Sha sha={card.sha} prefix />
				<Since card={card} />
				<span
					className={clsx(styles.source, styles.sourceOwn, styles.sourceFirst)}
				>
					{workflowsCopy.source}
				</span>
				{roles === null ? (
					<span className={clsx(styles.source, styles.sourceNeed)}>
						{workflowsCopy.needsPackages}
					</span>
				) : null}
			</div>
			<div
				className={clsx(styles.tabs)}
				role="tablist"
				aria-label={workflowsCopy.tabsLabel}
			>
				{shownTabs.map((item) => (
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
				<Diagram detail={detail} />
			) : tab === "stages" ? (
				<StagesTable stages={detail.stages} />
			) : tab === "roles" && roles !== null ? (
				<RolesTable roles={roles} />
			) : (
				<RunsTable runs={detail.runs} />
			)}
		</section>
	);
}

export function Page() {
	const page = useQuery(pageQuery.workflows).data;
	const cards = page?.cards;
	const now = useNow(60_000);
	const [picked, setPicked] = useState<string | null>(null);
	const [older, setOlder] = useState(false);
	const card = cards?.find((item) => versionKey(item) === picked) ?? cards?.[0];
	const folded = cards?.filter(
		(item, index) => index < newestShown || item.runs === 0,
	);
	const hidden = (cards?.length ?? 0) - (folded?.length ?? 0);
	const shown = older ? cards : folded;
	return (
		<PageFrame title={navLabel.workflows} subtitle={workflowsCopy.subtitle}>
			{cards === undefined ? null : cards.length === 0 ? (
				<p className={clsx(styles.empty)}>{workflowsCopy.empty}</p>
			) : (
				<>
					<div className={clsx(styles.cards)}>
						{(shown ?? cards).map((item) => (
							<Card
								key={versionKey(item)}
								card={item}
								reading={page?.reading ?? false}
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
