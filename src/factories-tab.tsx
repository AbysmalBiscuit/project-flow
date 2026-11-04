import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { textControl } from "./control-styles.ts";
import type {
	AttentionItem,
	FactoriesPage,
	FactoryCard,
	QueueItem,
	RunningRun,
} from "./factories-page.ts";
import { runPagePath } from "./page-links.ts";
import { pageQuery } from "./queries.ts";
import type { RunGraph, RunGraphNodeState } from "./run-domain.ts";
import { PageFrame } from "./shell.tsx";
import { costLabel, factoriesCopy, navLabel, spanText } from "./terms.ts";
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

const styles = stylex.create({
	grid: {
		display: "grid",
		gap: space.lg,
		marginBottom: space.lg,
	},
	tiles: {
		gridTemplateColumns: `repeat(auto-fit, minmax(${measure.tileMin}, 1fr))`,
	},
	boxes: {
		gridTemplateColumns: {
			default: `repeat(auto-fit, minmax(${measure.boxCardMin}, 1fr))`,
			[media.projectBar]: "minmax(0, 1fr)",
		},
	},
	two: {
		gridTemplateColumns: {
			default: "minmax(0, 2fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
		alignItems: "start",
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
	stretch: {
		alignSelf: "stretch",
	},
	kicker: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	tileValue: {
		color: colours.ink,
		fontSize: type.tileValue,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
	},
	tileWarn: {
		color: colours.warn,
	},
	tileBad: {
		color: colours.danger,
	},
	tileDetail: {
		display: "-webkit-box",
		overflow: "hidden",
		color: colours.inkSoft,
		fontSize: type.meta,
		overflowWrap: "anywhere",
		WebkitBoxOrient: "vertical",
		WebkitLineClamp: 2,
	},
	box: {
		borderLeftWidth: measure.boxEdge,
		borderLeftColor: colours.awaitingMerge,
	},
	boxOff: {
		borderLeftColor: colours.inkSoft,
		opacity: 0.6,
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
	meta: {
		color: colours.inkSoft,
		fontSize: type.meta,
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
	sourceNeed: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	sourceRow: {
		display: "flex",
		justifyContent: "flex-end",
		marginBottom: space.sm,
	},
	pill: {
		display: "inline-flex",
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	pillBad: {
		backgroundColor: colours.dangerWash,
		color: colours.danger,
	},
	pillInfo: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	meter: {
		display: "grid",
		gridTemplateColumns: `${measure.meterLabel} minmax(0, 1fr) ${measure.meterValue}`,
		gap: space.sm,
		alignItems: "center",
		margin: `${space.xs} 0`,
		color: colours.ink,
		fontSize: type.meter,
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
	meterValue: {
		color: colours.inkMuted,
		textAlign: "right",
		fontVariantNumeric: "tabular-nums",
	},
	note: {
		margin: `${space.sm} 0 0`,
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
	},
	nowrap: {
		whiteSpace: "nowrap",
	},
	wrap: {
		overflowWrap: "anywhere",
	},
	wide: {
		display: {
			default: null,
			[media.projectBar]: "none",
		},
	},
	agent: {
		color: colours.inkMuted,
		fontSize: type.small,
	},
	clamp: {
		display: "-webkit-box",
		overflow: "hidden",
		overflowWrap: "anywhere",
		WebkitBoxOrient: "vertical",
		WebkitLineClamp: 2,
	},
	link: {
		color: colours.link,
		textDecoration: "none",
	},
	steps: {
		display: "flex",
		gap: measure.stepGap,
	},
	step: {
		flexShrink: 0,
		width: measure.step,
		height: measure.stepHeight,
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
	},
	stepDone: {
		backgroundColor: colours.awaitingMerge,
	},
	stepCurrent: {
		backgroundColor: colours.accent,
	},
	stepFailed: {
		backgroundColor: colours.danger,
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
	},
	itemBody: {
		minWidth: 0,
		color: colours.inkMuted,
		fontSize: type.small,
		overflowWrap: "anywhere",
	},
	where: {
		marginLeft: "auto",
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.lane,
		whiteSpace: "nowrap",
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
});

/** The clock time, once a second, so the elapsed times count up between reads. */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

const since = (time: string | null | undefined, now: number): string | null =>
	time === null || time === undefined ? null : spanText(now - Date.parse(time));

function Source({
	children,
	need = false,
}: {
	children: string;
	need?: boolean;
}) {
	return (
		<span className={clsx(styles.source, need && styles.sourceNeed)}>
			{children}
		</span>
	);
}

function Card({
	title,
	source,
	children,
	stretch = false,
}: {
	title: string;
	source: string;
	children: ReactNode;
	stretch?: boolean;
}) {
	return (
		<section
			className={clsx(styles.card, stretch && styles.stretch)}
			aria-label={title}
		>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{title}</h2>
				<Source>{source}</Source>
			</div>
			{children}
		</section>
	);
}

function Tile({
	label,
	value,
	detail,
	tone,
}: {
	label: string;
	value: string;
	detail: string;
	tone?: "warn" | "bad";
}) {
	return (
		<div className={clsx(styles.card)}>
			<div className={clsx(styles.kicker)}>{label}</div>
			<div
				className={clsx(
					styles.tileValue,
					tone === "warn" && styles.tileWarn,
					tone === "bad" && styles.tileBad,
				)}
			>
				{value}
			</div>
			<div className={clsx(styles.tileDetail)} title={detail}>
				{detail}
			</div>
		</div>
	);
}

function Tiles({ page, now }: { page: FactoriesPage; now: number }) {
	const { tiles } = page;
	const wait = since(tiles.longestWaitSince, now);
	return (
		<div className={clsx(styles.grid, styles.tiles)}>
			<Tile
				label={factoriesCopy.tiles.running}
				value={String(tiles.running)}
				detail={
					tiles.slots === null
						? factoriesCopy.noSlots
						: factoriesCopy.ofSlots(tiles.slots.total)
				}
			/>
			<Tile
				label={factoriesCopy.tiles.queued}
				value={String(tiles.queued)}
				detail={
					wait === null ? factoriesCopy.noWait : factoriesCopy.longestWait(wait)
				}
			/>
			<Tile
				label={factoriesCopy.tiles.attention}
				value={String(tiles.attention.total)}
				detail={factoriesCopy.attentionParts(
					tiles.attention.failed,
					tiles.attention.asks,
				)}
				{...(tiles.attention.total > 0 ? { tone: "warn" as const } : {})}
			/>
			<Tile
				label={factoriesCopy.tiles.merged}
				value={String(tiles.merged.last)}
				detail={factoriesCopy.versus(tiles.merged.last - tiles.merged.before)}
			/>
			<Tile
				label={factoriesCopy.tiles.failures}
				value={String(tiles.failed.last)}
				detail={factoriesCopy.reasons(tiles.failed.reasons)}
				{...(tiles.failed.last > 0 ? { tone: "bad" as const } : {})}
			/>
			<Tile
				label={factoriesCopy.tiles.cost}
				value={`$${Math.round(tiles.cost.last)}`}
				detail={factoriesCopy.perMerged(
					tiles.cost.perMerged === null
						? null
						: costLabel(tiles.cost.perMerged),
				)}
			/>
		</div>
	);
}

function BoxCard({ box, now }: { box: FactoryCard; now: number }) {
	const heartbeat = since(box.heartbeatAt, now);
	const off = box.reachable !== true;
	return (
		<section
			className={clsx(styles.card, styles.box, off && styles.boxOff)}
			aria-label={box.name}
		>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{box.name}</h2>
				{box.role === null ? null : (
					<span className={clsx(styles.pill)}>
						{factoriesCopy.role[box.role]}
					</span>
				)}
				{off ? (
					<span className={clsx(styles.pill, styles.pillBad)}>
						{factoriesCopy.noAnswer}
					</span>
				) : null}
				<span className={clsx(styles.meta)}>
					{heartbeat === null
						? factoriesCopy.noHeartbeat
						: factoriesCopy.heartbeat(heartbeat)}
				</span>
			</div>
			<div className={clsx(styles.sourceRow)}>
				<Source>{factoriesCopy.sources.daemon}</Source>
				<Source need>{factoriesCopy.hostSource}</Source>
			</div>
			{off ? (
				<p className={clsx(styles.note)}>
					{factoriesCopy.unreachable(heartbeat)}
				</p>
			) : box.slots === undefined ? (
				<p className={clsx(styles.note)}>{factoriesCopy.noSlotCount}</p>
			) : (
				<div className={clsx(styles.meter)}>
					<span>{factoriesCopy.slots}</span>
					<span className={clsx(styles.bar)}>
						<span
							{...stylex.props(
								styles.fill(
									`${box.slots.total === 0 ? 0 : Math.min(100, (box.slots.used / box.slots.total) * 100)}%`,
								),
							)}
						/>
					</span>
					<span className={clsx(styles.meterValue)}>
						{factoriesCopy.busy(box.slots.used, box.slots.total)}
					</span>
				</div>
			)}
		</section>
	);
}

const stepStyle: Record<RunGraphNodeState, stylex.StyleXStyles | false> = {
	completed: styles.stepDone,
	current: styles.stepCurrent,
	failed: styles.stepFailed,
	ahead: false,
};

const checkpointRetries = 20;
const checkpointRetryMs = 500;

const agentKind = "codergen";
const exitKind = "exit";

/**
 * The agent stages of a run, one each: the done stages in the order of their first
 * visit, the current stage, then the stages ahead on the default path.
 */
function stepsOf(graph: RunGraph, completedStages: string[]) {
	const top = new Map(
		graph.nodes
			.filter((node) => !node.id.includes("/"))
			.map((node) => [node.id, node]),
	);
	const isAgent = (id: string) => top.get(id)?.kind === agentKind;
	const done = [...new Set(completedStages)].filter(
		(id) => isAgent(id) && top.get(id)?.state === "completed",
	);
	const current = [...top.values()].find(
		(node) => node.state === "current" || node.state === "failed",
	);
	const ahead: string[] = [];
	const seen = new Set<string>();
	let at = current?.id;
	while (at !== undefined && !seen.has(at) && top.get(at)?.kind !== exitKind) {
		seen.add(at);
		const from = at;
		const out = graph.edges.filter((edge) => edge.from === from);
		at = (out.find((edge) => edge.condition === undefined) ?? out[0])?.to;
		if (at !== undefined && isAgent(at) && top.get(at)?.state === "ahead") {
			ahead.push(at);
		}
	}
	return [
		...done,
		...(current === undefined || done.includes(current.id) ? [] : [current.id]),
		...ahead,
	].flatMap((id) => {
		const node = top.get(id);
		return node === undefined ? [] : [node];
	});
}

/** One block for each agent stage of the run, from its checkpoint. */
function Stepper({ run }: { run: RunningRun }) {
	// The first read of a checkpoint answers pending while the factory read runs.
	const checkpoint = useQuery({
		...pageQuery.checkpoint(run),
		retry: checkpointRetries,
		retryDelay: checkpointRetryMs,
	});
	const read = checkpoint.data;
	const nodes =
		read === undefined || typeof read === "string" || read.graph === null
			? []
			: stepsOf(read.graph, read.completedStages);
	return (
		<span className={clsx(styles.steps)}>
			{nodes.map((node) => (
				<span
					key={node.id}
					title={node.label}
					className={clsx(styles.step, stepStyle[node.state])}
				/>
			))}
		</span>
	);
}

/** What the run agent of the current stage does now, read only while the tab is open. */
function AgentWork({ run }: { run: RunningRun }) {
	const agents = useQuery(pageQuery.agents(run));
	const agent =
		agents.data?.find((item) => item.stage === run.stage) ?? agents.data?.[0];
	if (agent === undefined) {
		return null;
	}
	const work = agent.lastMessage ?? "";
	return (
		<span className={clsx(styles.agent, styles.clamp)} title={work}>
			{agent.tool === null ? work : `${agent.tool}: ${work}`}
		</span>
	);
}

function RunningTable({ runs, now }: { runs: RunningRun[]; now: number }) {
	if (runs.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noRunning}</p>;
	}
	const { columns } = factoriesCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.ticket}</th>
						<th className={clsx(styles.th)}>{columns.factory}</th>
						<th className={clsx(styles.th)}>{columns.stages}</th>
						<th className={clsx(styles.th)}>{columns.stage}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.inStage}
						</th>
						<th className={clsx(styles.th, styles.number)}>{columns.total}</th>
						<th className={clsx(styles.th)}>{columns.agent}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.cost}</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run, index) => {
						const last = index === runs.length - 1;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr key={run.id} className={clsx(styles.row)}>
								<td className={cell()}>
									<a
										href={runPagePath(run.id)}
										className={clsx(styles.link, ...textControl)}
									>
										{ticketLabel(run.key)}
									</a>
								</td>
								<td className={cell()}>{run.factory}</td>
								<td className={cell()}>
									<Stepper run={run} />
								</td>
								<td className={cell(styles.wrap)}>{run.stage}</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(run.stageSince, now)}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(run.startedAt, now)}
								</td>
								<td className={cell()}>
									<AgentWork run={run} />
								</td>
								<td className={cell(styles.number)}>
									{run.costUsd === undefined ? null : costLabel(run.costUsd)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function AttentionList({
	items,
	now,
}: {
	items: AttentionItem[];
	now: number;
}) {
	if (items.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noAttention}</p>;
	}
	return (
		<ul className={clsx(styles.list)}>
			{items.map((item) => (
				<li
					key={`${item.kind} ${item.runId} ${item.reason}`}
					className={clsx(styles.item)}
				>
					<span
						className={clsx(
							styles.pill,
							item.kind === "failed" ? styles.pillBad : styles.pillInfo,
						)}
					>
						{factoriesCopy.kind[item.kind]}
					</span>
					<span className={clsx(styles.itemBody)}>
						<a
							href={runPagePath(item.runId)}
							className={clsx(styles.link, ...textControl)}
						>
							{ticketLabel(item.key)}
						</a>
						<span className={clsx(styles.clamp)} title={item.reason}>
							{item.reason}
						</span>
					</span>
					<span className={clsx(styles.where)}>{since(item.since, now)}</span>
				</li>
			))}
		</ul>
	);
}

function QueueTable({ items, now }: { items: QueueItem[]; now: number }) {
	if (items.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noQueue}</p>;
	}
	const { columns } = factoriesCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.rank}</th>
						<th className={clsx(styles.th)}>{columns.ticket}</th>
						<th className={clsx(styles.th, styles.wide)}>{columns.source}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.waiting}
						</th>
						<th className={clsx(styles.th)}>{columns.waitsOn}</th>
					</tr>
				</thead>
				<tbody>
					{items.map((item, index) => {
						const last = index === items.length - 1;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr
								key={`${item.factory} ${item.source} ${item.key}`}
								className={clsx(styles.row)}
							>
								<td className={cell()}>{item.rank}</td>
								<td className={cell(styles.nowrap)}>
									{item.url === undefined ? (
										ticketLabel(item.key)
									) : (
										<a
											href={item.url}
											target="_blank"
											rel="noreferrer"
											className={clsx(styles.link, ...textControl)}
										>
											{ticketLabel(item.key)}
										</a>
									)}
								</td>
								<td className={cell(styles.wide)}>
									{`${item.factory}: ${item.source}`}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(item.since, now)}
								</td>
								<td className={cell()}>
									{item.hold === undefined
										? item.waits
										: factoriesCopy.held(item.hold.failures)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function NotServed({ page, panel }: { page: FactoriesPage; panel: "queue" }) {
	return page.notServed
		.filter((item) => item.panel === panel)
		.map((item) => (
			<p key={item.factory} className={clsx(styles.note)}>
				{factoriesCopy.notServed(item.factory, item.route)}
			</p>
		));
}

export function Page() {
	const query = useQuery(pageQuery.factories);
	const now = useNow();
	const page = query.data;
	const updated =
		query.dataUpdatedAt > 0
			? ` ${factoriesCopy.updated(spanText(now - query.dataUpdatedAt))}`
			: "";
	return (
		<PageFrame
			title={navLabel.factories}
			subtitle={`${factoriesCopy.subtitle}${updated}`}
		>
			{page === undefined ? null : (
				<>
					<Tiles page={page} now={now} />
					<div className={clsx(styles.grid, styles.boxes)}>
						{page.boxes.map((box) => (
							<BoxCard key={box.name} box={box} now={now} />
						))}
					</div>
					<div className={clsx(styles.grid, styles.two)}>
						<Card
							title={factoriesCopy.running}
							source={factoriesCopy.sources.running}
						>
							<RunningTable runs={page.running} now={now} />
							<p className={clsx(styles.note)}>{factoriesCopy.runningNote}</p>
						</Card>
						<Card
							title={factoriesCopy.attention}
							source={factoriesCopy.sources.attention}
							stretch
						>
							<AttentionList items={page.attention} now={now} />
						</Card>
					</div>
					<Card
						title={factoriesCopy.queue}
						source={factoriesCopy.sources.queue}
					>
						<QueueTable items={page.queue} now={now} />
						<NotServed page={page} panel="queue" />
					</Card>
				</>
			)}
		</PageFrame>
	);
}
