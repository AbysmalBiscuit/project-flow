import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import type { RunGraph as Graph, ShownFactoryRun } from "./domain.ts";
import { pageQuery } from "./queries-page.ts";
import type { DiagramCalls } from "./run-graph-model.ts";
import { GraphPane } from "./run-graph-pane.tsx";
import { StagePane } from "./run-stage-pane.tsx";
import { stageFacts } from "./run-stage.tsx";
import { measure, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	withPane: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "flex-end",
		gap: space.md,
	},
	paneTop: {
		alignItems: "flex-start",
	},
	graphColumn: {
		flexGrow: 1,
		flexBasis: measure.diagram,
		minWidth: 0,
	},
});

/** A workflow graph with no run: each stage in the shape of its node, its border in the colour of its role. The `aside` shows beside the graph. */
export function WorkflowDiagram({
	graph,
	diagram,
	aside,
}: {
	graph: Graph;
	diagram: DiagramCalls;
	aside: ReactNode;
}) {
	return (
		<div className={clsx(styles.withPane, styles.paneTop)}>
			<div className={clsx(styles.graphColumn)}>
				<GraphPane graph={graph} run={null} diagram={diagram} />
			</div>
			{aside}
		</div>
	);
}

/** The run's workflow graph, each stage in the shape of its workflow node and marked from the run checkpoint. */
export function RunGraph({
	run,
	onOpenStage,
}: {
	run: ShownFactoryRun;
	onOpenStage: (stage: string) => void;
}) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	const agents = useQuery(pageQuery.agents(run)).data ?? [];
	const [picked, setPicked] = useState<string | null>(null);
	if (typeof data !== "object" || data.graph === null) {
		return null;
	}
	const stages = data.graph.nodes.flatMap((node) => [
		node,
		...(node.child ?? []),
	]);
	// A picked child stage that the checkpoint no longer lists falls back to its caller.
	const stage =
		stages.find((item) => item.id === picked) ??
		stages.find((item) => item.id === picked?.split("/")[0]);
	return (
		<div className={clsx(styles.withPane)}>
			<div className={clsx(styles.graphColumn)}>
				<GraphPane
					graph={data.graph}
					run={{ checkpoint: data, agents, onPick: setPicked }}
				/>
			</div>
			{stage === undefined ? null : (
				<StagePane
					run={run}
					facts={stageFacts(stage, data, agents)}
					onClose={() => setPicked(null)}
					onOpenStage={onOpenStage}
				/>
			)}
		</div>
	);
}
