import * as stylex from "@stylexjs/stylex";

import type {
	RunAgent,
	RunCheckpoint,
	RunGraph,
	RunGraphNode,
	RunGraphNodeState,
	RunStage,
	TurnUsage,
} from "./domain.ts";
import { spanLabel } from "./poll-age.ts";
import {
	agentToolLabel,
	costLabel,
	runStageStateLabel,
	stageRetriesLabel,
	stageVisitsLabel,
	usagePartSeparator,
} from "./terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

/**
 * What a stage view shows: the stage, the current tool of its live agent, and the usage of an ended stage.
 * A stage that calls a child graph holds the stages of that child graph.
 */
export type StageFacts = {
	stage: RunStage & Pick<RunGraphNode, "child">;
	tool: string | null;
	usage: TurnUsage | undefined;
};

/** The facts of `stage` from the run checkpoint and the run agents. */
export function stageFacts(
	stage: StageFacts["stage"],
	checkpoint: RunCheckpoint,
	agents: readonly RunAgent[],
): StageFacts {
	const live = stage.state === "current";
	const agent = live
		? (agents.find((item) => item.stage === stage.id) ??
			agents.find((item) => item.stage.split("/")[0] === stage.id))
		: undefined;
	return {
		stage,
		tool: agent?.tool ?? null,
		usage:
			stage.state === "completed" || stage.state === "failed"
				? checkpoint.usage?.stages[stage.id]
				: undefined,
	};
}

/** True when the run is at `stage`: it works there, or it stopped there on a failure. */
export function isRunAt(stage: RunStage): boolean {
	return stage.state === "current" || stage.state === "failed";
}

/** The stage where the run is now: the live stage of an open child graph, else the live top-level stage. */
export function liveStage(graph: RunGraph): RunStage | undefined {
	const node = graph.nodes.find(isRunAt);
	return node?.child?.findLast(isRunAt) ?? node;
}

export function stageTimeLabel(usage: TurnUsage): string {
	return spanLabel(0, usage.durationS * 1000);
}

const styles = stylex.create({
	card: {
		display: "flex",
		flexDirection: "column",
		gap: space.twoXs,
		minWidth: 0,
		color: colours.ink,
		fontSize: type.meta,
		lineHeight: type.line,
	},
	label: {
		overflow: "hidden",
		fontWeight: type.weight,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	facts: {
		display: "flex",
		flexWrap: "wrap",
		columnGap: space.xs,
		color: colours.inkMuted,
	},
	retries: {
		color: colours.warnInk,
		fontWeight: type.weight,
	},
	failed: {
		color: colours.danger,
		fontWeight: type.weight,
	},
	tool: {
		overflow: "hidden",
		color: colours.accent,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	boxed: {
		paddingBlock: space.xs,
		paddingInline: space.sm,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderRadius: radius.sm,
	},
});

/** The border and fill of a stage in each state, for a boxed stage. */
export const stageBox = stylex.create({
	current: {
		borderWidth: measure.focus,
		borderColor: colours.accent,
		backgroundColor: colours.chip,
	},
	completed: {
		borderColor: colours.lineStrong,
		backgroundColor: colours.surfaceMuted,
	},
	ahead: {
		borderStyle: "dashed",
		borderColor: colours.lineStrong,
		backgroundColor: colours.raised,
	},
	failed: {
		borderWidth: measure.focus,
		borderColor: colours.danger,
		backgroundColor: colours.warnWash,
	},
});

/** The stroke and fill of a stage shape in each state. */
export const stageStroke = stylex.create({
	current: {
		fill: colours.chip,
		stroke: colours.accent,
		strokeWidth: measure.focus,
	},
	completed: {
		fill: colours.surfaceMuted,
		stroke: colours.lineStrong,
		strokeWidth: measure.hairline,
	},
	ahead: {
		fill: colours.raised,
		stroke: colours.lineStrong,
		strokeWidth: measure.hairline,
		strokeDasharray: `${measure.edgeDash} ${measure.edgeDash}`,
	},
	failed: {
		fill: colours.warnWash,
		stroke: colours.danger,
		strokeWidth: measure.focus,
	},
});

/**
 * One run stage: its label, state, visits and retries. A live stage adds the
 * current tool of its agent, and an ended stage adds its duration and cost.
 * A `boxed` stage draws its own border; the run graph draws a shape instead.
 */
export function StageCard({
	facts: { stage, tool, usage },
	boxed = false,
}: {
	facts: StageFacts;
	boxed?: boolean;
}) {
	const state: RunGraphNodeState = stage.state;
	return (
		<span
			className={clsx(
				styles.card,
				boxed && styles.boxed,
				boxed && stageBox[state],
			)}
			title={stage.label}
			data-stage={stage.id}
			data-stage-state={state}
			data-stage-visits={stage.visits}
			data-stage-retries={stage.retries}
		>
			<span className={clsx(styles.label)}>{stage.label}</span>
			<span className={clsx(styles.facts)}>
				<span className={clsx(state === "failed" && styles.failed)}>
					{runStageStateLabel[state]}
				</span>
				{stage.visits === 0 ? null : (
					<span>{stageVisitsLabel(stage.visits)}</span>
				)}
				{stage.retries === 0 ? null : (
					<span className={clsx(styles.retries)}>
						{stageRetriesLabel(stage.retries)}
					</span>
				)}
			</span>
			{tool === null ? null : (
				<span className={clsx(styles.tool)} data-stage-tool={tool}>
					{agentToolLabel(tool)}
				</span>
			)}
			{usage === undefined ? null : (
				<span className={clsx(styles.facts)} data-stage-usage="">
					{[stageTimeLabel(usage), costLabel(usage.costUsd)].join(
						usagePartSeparator,
					)}
				</span>
			)}
		</span>
	);
}
