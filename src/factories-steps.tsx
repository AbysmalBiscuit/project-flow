import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import type { RunningRun } from "./factories-page.ts";
import { styles } from "./factories-parts.tsx";
import { pageQuery } from "./queries-page.ts";
import type { RunGraph, RunGraphNodeState } from "./run-domain.ts";
import { colours, measure, radius, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const stepStyles = stylex.create({
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
	stepFailed: {
		backgroundColor: colours.danger,
	},
	stepStalled: {
		backgroundColor: colours.warn,
	},
});

const stepStyle: Record<RunGraphNodeState, stylex.StyleXStyles | false> = {
	completed: stepStyles.stepDone,
	current: styles.stepCurrent,
	failed: stepStyles.stepFailed,
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
export function Stepper({ run }: { run: RunningRun }) {
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
		<span className={clsx(stepStyles.steps)}>
			{nodes.map((node) => (
				<span
					key={node.id}
					title={node.label}
					className={clsx(
						stepStyles.step,
						node.state === "current" && run.stall !== undefined
							? stepStyles.stepStalled
							: stepStyle[node.state],
					)}
				/>
			))}
		</span>
	);
}

/** What the run agent of the current stage does now, read only while the tab is open. */
export function AgentWork({ run }: { run: RunningRun }) {
	const agents = useQuery(pageQuery.agents(run));
	const agent =
		agents.data?.find((item) => item.stage === run.stage) ?? agents.data?.[0];
	if (agent === undefined) {
		return null;
	}
	const work = agent.lastMessage ?? "";
	return (
		<span className={clsx(stepStyles.agent, stepStyles.clamp)} title={work}>
			{agent.tool === null ? work : `${agent.tool}: ${work}`}
		</span>
	);
}
