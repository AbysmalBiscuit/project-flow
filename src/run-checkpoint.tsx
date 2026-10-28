import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import type {
	RunAgent,
	RunCheckpoint,
	RunStage,
	ShownFactoryRun,
	TurnUsage,
} from "./domain.ts";
import { Loading } from "./loading.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { StageDetail } from "./run-stage-view.tsx";
import {
	liveStage,
	StageCard,
	stageFacts,
	stageTimeLabel,
} from "./run-stage.tsx";
import {
	childStagesLabel,
	costLabel,
	currentStageLabel,
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

/** The id of a stage in the Stages tab, so a link can open the tab at that stage. */
export function stageAnchor(stage: string): string {
	return `stage-${stage}`;
}

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

type ReachedStage = { stage: RunStage; children: RunStage[] };

/**
 * The stages that the run reached, in the order that it first reached them,
 * each with the stages of the child graph that it calls. With no graph, each
 * stage takes its name as its label.
 */
function stageTree(checkpoint: RunCheckpoint): ReachedStage[] {
	const nodes = new Map(
		(checkpoint.graph?.nodes ?? []).map((node) => [node.id, node]),
	);
	const current = checkpoint.stage?.split("/")[0];
	return stagesOf(checkpoint).flatMap((id): ReachedStage[] => {
		const node = nodes.get(id);
		if (node !== undefined) {
			return [{ stage: node, children: node.child ?? [] }];
		}
		return checkpoint.graph === null
			? [
					{
						stage: {
							id,
							label: id,
							state: id === current ? "current" : "completed",
							visits: checkpoint.visits[id] ?? 0,
							retries: checkpoint.retries[id] ?? 0,
						},
						children: [],
					},
				]
			: [];
	});
}

function reachedStages(checkpoint: RunCheckpoint): RunStage[] {
	return stageTree(checkpoint).flatMap(({ stage, children }) => [
		stage,
		...children,
	]);
}

/**
 * One stage of the Stages tab. It opens to its stage transcript and the run
 * context. The current stage and the stage that `opened` names start open.
 */
function StageItem({
	run,
	stage,
	checkpoint,
	agents,
	opened,
	children,
}: {
	run: ShownFactoryRun;
	stage: RunStage;
	checkpoint: RunCheckpoint;
	agents: readonly RunAgent[];
	opened: string | null;
	children?: ReactNode;
}) {
	const facts = stageFacts(stage, checkpoint, agents);
	const [open, setOpen] = useState(
		stage.state === "current" || stage.id === opened,
	);
	return (
		<li
			aria-current={stage.state === "current" ? "step" : undefined}
			id={stageAnchor(stage.id)}
			ref={(item) => {
				if (item !== null && stage.id === opened) {
					item.scrollIntoView({ block: "start" });
				}
			}}
		>
			<details
				className={clsx(panel.stageItem)}
				open={open}
				onToggle={(event) => setOpen(event.currentTarget.open)}
			>
				<summary className={clsx(panel.stageSummary)}>
					<StageCard facts={facts} boxed />
				</summary>
				{open ? <StageDetail run={run} facts={facts} /> : null}
			</details>
			{children}
		</li>
	);
}

/**
 * The stages of a factory run from its run checkpoint, each in the stage view.
 * The stages of a child graph list under the stage that calls it.
 */
export function RunStages({
	run,
	opened = null,
}: {
	run: ShownFactoryRun;
	opened?: string | null;
}) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	const agents = useQuery(pageQuery.agents(run)).data ?? [];
	if (data === undefined) {
		return <Loading />;
	}
	if (data === "not served") {
		return <NotServed data={runTabData.stages} />;
	}
	if (data === "missing") {
		return <NoData />;
	}
	const shared = { run, checkpoint: data, agents, opened };
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runStagesLabel}</h3>
			<ul className={clsx(panel.stages)} aria-label={runStagesLabel}>
				{stageTree(data).map(({ stage, children }) => (
					<StageItem key={stage.id} stage={stage} {...shared}>
						{children.length === 0 ? null : (
							<ul
								className={clsx(panel.stages, panel.childStages)}
								aria-label={childStagesLabel(stage.label)}
							>
								{children.map((child) => (
									<StageItem key={child.id} stage={child} {...shared} />
								))}
							</ul>
						)}
					</StageItem>
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
		return <Loading />;
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
