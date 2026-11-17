import { board } from "./board-styles.ts";
import type { RunGraph as Graph } from "./domain.ts";
import { LegendFrame } from "./graph-core-view.tsx";
import { states } from "./run-graph-model.ts";
import { nodeStyles } from "./run-graph-nodes.tsx";
import { Outline, roleStrokeOf } from "./run-graph-outline.tsx";
import { stageStroke } from "./run-stage.tsx";
import {
	runGraphLegendLabel,
	runStageStateLabel,
	stageKindLabel,
} from "./run-terms.ts";
import { clsx } from "./ui.ts";

/**
 * The stage states of a run, or the stage roles of a diagram with no run,
 * then each shape in the graph with its kind, and the edge text.
 */
export function Legend({
	graph,
	byRole,
	opens,
}: {
	graph: Graph;
	byRole: boolean;
	opens: boolean;
}) {
	const shapes = [
		...new Map(
			graph.nodes.map((node) => [`${node.shape}\n${node.kind}`, node]),
		).values(),
	];
	const framed = graph.nodes.some((node) => node.child !== undefined);
	// A called graph draws its stages as tool stages.
	const roles = [
		...new Set(
			graph.nodes.flatMap((node) => [
				node.role,
				...(node.child === undefined ? [] : [undefined]),
			]),
		),
	];
	return (
		<LegendFrame id="run-graph-legend" label={runGraphLegendLabel.legend}>
			{byRole ? (
				<ul
					className={clsx(nodeStyles.legendRow)}
					aria-label={runGraphLegendLabel.roles}
				>
					{roles.map((role) => (
						<li
							key={role ?? ""}
							className={clsx(board.legendItem)}
							data-legend-role={role ?? runGraphLegendLabel.noRole}
						>
							<Outline
								shape="box"
								stroke={roleStrokeOf(role)}
								layout={nodeStyles.glyph}
							/>
							{role ?? runGraphLegendLabel.noRole}
						</li>
					))}
				</ul>
			) : (
				<ul
					className={clsx(nodeStyles.legendRow)}
					aria-label={runGraphLegendLabel.states}
				>
					{states.map((state) => (
						<li
							key={state}
							className={clsx(board.legendItem)}
							data-legend-state={state}
						>
							<Outline
								shape="box"
								stroke={stageStroke[state]}
								layout={nodeStyles.glyph}
							/>
							{runStageStateLabel[state]}
						</li>
					))}
				</ul>
			)}
			<ul
				className={clsx(nodeStyles.legendRow)}
				aria-label={runGraphLegendLabel.shapes}
			>
				{shapes.map((node) => (
					<li
						key={`${node.shape}\n${node.kind}`}
						className={clsx(board.legendItem)}
						data-legend-shape={node.shape}
					>
						<Outline
							shape={node.shape}
							stroke={stageStroke.completed}
							layout={nodeStyles.glyph}
						/>
						{stageKindLabel(node.kind)}
					</li>
				))}
			</ul>
			<p className={clsx(board.legendNote, board.legendEdge)}>
				<span className={clsx(board.legendSwatch)} />
				<span className={clsx(nodeStyles.edgeText, nodeStyles.legendText)}>
					{runGraphLegendLabel.edgeSample}
				</span>
				{runGraphLegendLabel.edge}
			</p>
			{opens ? (
				<p className={clsx(board.legendNote)}>
					{runGraphLegendLabel.opensGraph}
				</p>
			) : null}
			{framed ? (
				<p className={clsx(board.legendNote)}>
					{byRole
						? runGraphLegendLabel.calledGraphDiagram
						: runGraphLegendLabel.calledGraph}
				</p>
			) : null}
		</LegendFrame>
	);
}
