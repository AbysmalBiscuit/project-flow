import { useQuery } from "@tanstack/react-query";

import type {
	RunCheckpoint,
	RunStage,
	ShownFactoryRun,
	TurnUsage,
} from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import {
	liveStage,
	StageCard,
	stageFacts,
	stageTimeLabel,
} from "./run-stage.tsx";
import {
	costLabel,
	currentStageLabel,
	loadingLabel,
	noRunDataLabel,
	notServedLabel,
	runStagesLabel,
	runTabData,
	runUsageLabel,
	tokensLabel,
	toolCountsLabel,
	usageFactLabel,
	usagePartSeparator,
} from "./terms.ts";
import { clsx } from "./ui.ts";

/** Each stage once, in the order the run first reached it, then the current stage. */
function stagesOf(checkpoint: RunCheckpoint): string[] {
	const current = checkpoint.stage?.split("/")[0];
	return [
		...new Set([
			...checkpoint.completedStages,
			...(current === undefined ? [] : [current]),
		]),
	];
}

function stageUsageLabel(usage: TurnUsage): string {
	return [
		tokensLabel(usage.inputTokens, usage.outputTokens),
		costLabel(usage.costUsd),
		stageTimeLabel(usage),
		toolCountsLabel(usage.tools),
	]
		.filter((part) => part !== "")
		.join(usagePartSeparator);
}

/** The empty state of a run page tab whose factory route answers 404, or that Project Flow does not read yet. */
export function NotServed({ data }: { data: string }) {
	return (
		<p className={clsx(panel.note)} data-not-served="">
			{notServedLabel(data)}
		</p>
	);
}

function NoData() {
	return <p className={clsx(panel.note)}>{noRunDataLabel}</p>;
}

/** The usage sum of a run: tokens, cost, time and the count of each tool. */
function RunUsageTotal({ usage }: { usage: TurnUsage }) {
	const facts = [
		[usageFactLabel.tokens, tokensLabel(usage.inputTokens, usage.outputTokens)],
		[usageFactLabel.cost, costLabel(usage.costUsd)],
		[usageFactLabel.time, stageTimeLabel(usage)],
		[usageFactLabel.tools, toolCountsLabel(usage.tools)],
	] as const;
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runUsageLabel}</h3>
			<dl className={clsx(panel.facts)} aria-label={runUsageLabel}>
				{facts.map(([label, value]) =>
					value === "" ? null : (
						<div key={label} className={clsx(panel.fact)}>
							<dt className={clsx(panel.factLabel)}>{label}</dt>
							<dd className={clsx(panel.factValue)}>{value}</dd>
						</div>
					),
				)}
			</dl>
		</>
	);
}

/**
 * The stages that the run reached, in the order that it first reached them.
 * The stages of a child graph follow the stage that calls it. With no graph,
 * each stage takes its name as its label.
 */
function reachedStages(checkpoint: RunCheckpoint): RunStage[] {
	const nodes = new Map(
		(checkpoint.graph?.nodes ?? []).map((node) => [node.id, node]),
	);
	const current = checkpoint.stage?.split("/")[0];
	return stagesOf(checkpoint).flatMap((id): RunStage[] => {
		const node = nodes.get(id);
		if (node !== undefined) {
			return [node, ...(node.child ?? [])];
		}
		return checkpoint.graph === null
			? [
					{
						id,
						label: id,
						state: id === current ? "current" : "completed",
						visits: checkpoint.visits[id] ?? 0,
						retries: checkpoint.retries[id] ?? 0,
					},
				]
			: [];
	});
}

/** The stages of a factory run from its run checkpoint, each in the stage view. */
export function RunStages({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	const agents = useQuery(pageQuery.agents(run)).data ?? [];
	if (data === undefined) {
		return <p className={clsx(panel.note)}>{loadingLabel}</p>;
	}
	if (data === "not served") {
		return <NotServed data={runTabData.stages} />;
	}
	if (data === "missing") {
		return <NoData />;
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runStagesLabel}</h3>
			<ul className={clsx(panel.stages)} aria-label={runStagesLabel}>
				{reachedStages(data).map((stage) => (
					<li
						key={stage.id}
						aria-current={stage.state === "current" ? "step" : undefined}
					>
						<StageCard facts={stageFacts(stage, data, agents)} boxed />
					</li>
				))}
			</ul>
		</>
	);
}

/** The stage where a factory run is now, in the stage view. */
export function RunCurrentStage({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	const agents = useQuery(pageQuery.agents(run)).data ?? [];
	if (typeof data !== "object") {
		return null;
	}
	const stage =
		data.graph === null
			? reachedStages(data).find((item) => item.state === "current")
			: liveStage(data.graph);
	if (stage === undefined) {
		return null;
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{currentStageLabel}</h3>
			<div className={clsx(panel.stages)}>
				<StageCard facts={stageFacts(stage, data, agents)} boxed />
			</div>
		</>
	);
}

/** The usage of a factory run from its recorded turns: the sum, then the usage of each stage. */
export function RunUsage({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	if (data === undefined) {
		return <p className={clsx(panel.note)}>{loadingLabel}</p>;
	}
	if (data === "not served" || (data !== "missing" && data.usageNotServed)) {
		return <NotServed data={runTabData.usage} />;
	}
	if (data === "missing" || data.usage === undefined) {
		return <NoData />;
	}
	return (
		<>
			<RunUsageTotal usage={data.usage.total} />
			<ul className={clsx(panel.relations)} aria-label={runStagesLabel}>
				{Object.entries(data.usage.stages).map(([stage, usage]) => (
					<li
						key={stage}
						className={clsx(panel.relation, panel.stage)}
						data-stage={stage}
					>
						<span>{stage}</span>
						<span className={clsx(panel.stageUsage)}>
							{stageUsageLabel(usage)}
						</span>
					</li>
				))}
			</ul>
		</>
	);
}
