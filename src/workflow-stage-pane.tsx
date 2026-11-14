import * as stylex from "@stylexjs/stylex";

import { edgeText } from "./graph-workflow.ts";
import { RunFact } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import type { RunGraph, RunGraphNode } from "./run-domain.ts";
import { roleInkOf } from "./run-graph.tsx";
import { SidePane } from "./side-pane.tsx";
import { openGraphLabel, stageKindLabel, workflowsCopy } from "./terms.ts";
import { colours, font, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import type { WorkflowRole, WorkflowStage } from "./workflows-page.ts";

const styles = stylex.create({
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
	link: {
		borderWidth: 0,
		padding: 0,
		backgroundColor: "transparent",
		color: colours.link,
		font: "inherit",
		fontSize: type.small,
		cursor: "pointer",
	},
	edges: {
		margin: 0,
		padding: 0,
		listStyle: "none",
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
		fontSize: type.meta,
		color: colours.ink,
	},
	edgeText: {
		marginLeft: space.sm,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.small,
	},
});

/** The pane beside the Workflows diagram that shows one stage: what runs it, how it performs and where it leads. */
export function WorkflowStagePane({
	graph,
	stage,
	stats,
	role,
	opens,
	onOpen,
	onClose,
}: {
	graph: RunGraph;
	stage: RunGraphNode;
	/** Undefined when no run of the version visited the stage. */
	stats: WorkflowStage | undefined;
	/** Undefined when the stage has no role or no factory lists the version. */
	role: WorkflowRole | undefined;
	/** The graph file that the stage calls. */
	opens: string | null;
	onOpen: (graph: string) => void;
	onClose: () => void;
}) {
	const nodeLabel = (id: string): string =>
		graph.nodes.find((node) => node.id === id)?.label ?? id;
	const incoming = graph.edges.flatMap((edge, index) =>
		edge.to === stage.id
			? [
					{
						key: String(index),
						stage: nodeLabel(edge.from),
						text: edgeText(edge),
					},
				]
			: [],
	);
	const outgoing = graph.edges.flatMap((edge, index) =>
		edge.from === stage.id
			? [
					{
						key: String(index),
						stage: nodeLabel(edge.to),
						text: edgeText(edge),
					},
				]
			: [],
	);

	return (
		<SidePane
			label={workflowsCopy.pane.label}
			closeLabel={workflowsCopy.pane.close}
			onClose={onClose}
			data-workflow-stage={stage.id}
			head={<h3 className={clsx(panel.heading)}>{stage.label}</h3>}
		>
			<dl className={clsx(panel.facts)}>
				<RunFact label={workflowsCopy.pane.kind}>
					{stageKindLabel(stage.kind)}
				</RunFact>
				<RunFact label={workflowsCopy.pane.role}>
					{stage.role === undefined ? (
						workflowsCopy.pane.noRole
					) : (
						<span className={clsx(styles.rolePill, roleInkOf(stage.role))}>
							{stage.role}
						</span>
					)}
				</RunFact>
				{role === undefined ? null : (
					<>
						<RunFact label={workflowsCopy.pane.harness}>
							<span className={clsx(styles.mono)}>
								{role.harnesses.join(", ") || workflowsCopy.none}
							</span>
						</RunFact>
						<RunFact label={workflowsCopy.pane.model}>
							<span className={clsx(styles.mono)}>
								{role.models.join(", ") || workflowsCopy.none}
							</span>
						</RunFact>
					</>
				)}
				{opens === null ? null : (
					<RunFact label={workflowsCopy.pane.calls}>
						<button
							type="button"
							className={clsx(styles.link)}
							onClick={() => onOpen(opens)}
						>
							{openGraphLabel(opens)}
						</button>
					</RunFact>
				)}
			</dl>
			<h3 className={clsx(panel.sectionLabel)}>{workflowsCopy.pane.stats}</h3>
			{stats === undefined ? (
				<p className={clsx(panel.note)}>{workflowsCopy.pane.noStats}</p>
			) : (
				<dl className={clsx(panel.facts)}>
					<RunFact label={workflowsCopy.columns.visits}>
						{workflowsCopy.visits(stats.visitsPerRun)}
					</RunFact>
					<RunFact label={workflowsCopy.columns.failRate}>
						{workflowsCopy.share(stats.failRate)}
					</RunFact>
					<RunFact label={workflowsCopy.columns.p50}>
						{workflowsCopy.seconds(stats.p50S)}
					</RunFact>
					<RunFact label={workflowsCopy.columns.p95}>
						{workflowsCopy.seconds(stats.p95S)}
					</RunFact>
					<RunFact label={workflowsCopy.columns.tokens}>
						{stats.tokensPerRun === null
							? workflowsCopy.none
							: workflowsCopy.tokens(stats.tokensPerRun)}
					</RunFact>
					<RunFact label={workflowsCopy.columns.cost}>
						{workflowsCopy.cost(stats.costPerRun)}
					</RunFact>
				</dl>
			)}
			<Edges title={workflowsCopy.pane.from} items={incoming} />
			<Edges title={workflowsCopy.pane.to} items={outgoing} />
		</SidePane>
	);
}

function Edges({
	title,
	items,
}: {
	title: string;
	items: { key: string; stage: string; text: string | undefined }[];
}) {
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{title}</h3>
			{items.length === 0 ? (
				<p className={clsx(panel.note)}>{workflowsCopy.pane.noEdge}</p>
			) : (
				<ul className={clsx(styles.edges)}>
					{items.map((item) => (
						<li key={item.key}>
							{item.stage}
							{item.text === undefined ? null : (
								<span className={clsx(styles.edgeText)}>{item.text}</span>
							)}
						</li>
					))}
				</ul>
			)}
		</>
	);
}
