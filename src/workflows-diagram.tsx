import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";

import { WorkflowDiagram } from "./run-graph.tsx";
import {
	colours,
	measure,
	media,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { useUrlParam } from "./url-param.ts";
import { WorkflowStagePane } from "./workflow-stage-pane.tsx";
import type { WorkflowDetail } from "./workflows-page.ts";
import { styles } from "./workflows-styles.ts";
import { workflowsCopy } from "./workflows-terms.ts";

const diagramStyles = stylex.create({
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
});

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

export function Diagram({ detail }: { detail: WorkflowDetail }) {
	const { graph } = detail;
	const [picked, setPicked] = useUrlParam("graph");
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
			<div className={clsx(diagramStyles.diagramHead)}>
				<ol
					className={clsx(diagramStyles.chips)}
					aria-label={workflowsCopy.graphsLabel}
				>
					{graph.graphs.map((item) => (
						<li key={item.name} className={clsx(diagramStyles.chipItem)}>
							<button
								type="button"
								aria-pressed={item === shown}
								className={clsx(
									diagramStyles.chip,
									item.entry && diagramStyles.chipMain,
									item === shown && diagramStyles.chipOn,
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
								<span className={clsx(diagramStyles.chipNote)}>
									{callerNote(item, graph.graphs)}
								</span>
							</button>
						</li>
					))}
				</ol>
				<p className={clsx(diagramStyles.note)}>
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
