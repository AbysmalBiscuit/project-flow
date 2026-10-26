import { useQuery } from "@tanstack/react-query";

import type { RunCheckpoint, ShownFactoryRun, TurnUsage } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { spanLabel } from "./poll-age.ts";
import { pageQuery } from "./queries.ts";
import {
	costLabel,
	currentStageLabel,
	loadingLabel,
	noRunDataLabel,
	notServedLabel,
	runStagesLabel,
	runTabData,
	runUsageLabel,
	stageRetriesLabel,
	stageVisitsLabel,
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

function timeLabel(usage: TurnUsage): string {
	return spanLabel(0, usage.durationS * 1000);
}

function stageUsageLabel(usage: TurnUsage): string {
	return [
		tokensLabel(usage.inputTokens, usage.outputTokens),
		costLabel(usage.costUsd),
		timeLabel(usage),
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
		[usageFactLabel.time, timeLabel(usage)],
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

/** The stages of a factory run from its run checkpoint, with the visits, retries and usage of each. */
export function RunStages({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	if (data === undefined) {
		return <p className={clsx(panel.note)}>{loadingLabel}</p>;
	}
	if (data === "not served") {
		return <NotServed data={runTabData.stages} />;
	}
	if (data === "missing") {
		return <NoData />;
	}
	const current = data.stage?.split("/")[0];
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runStagesLabel}</h3>
			<ul className={clsx(panel.relations)} aria-label={runStagesLabel}>
				{stagesOf(data).map((stage) => {
					const visits = data.visits[stage] ?? 0;
					const retries = data.retries[stage] ?? 0;
					const usage = data.usage?.stages[stage];
					const isCurrent = stage === current;
					return (
						<li
							key={stage}
							className={clsx(
								panel.relation,
								panel.stage,
								isCurrent && panel.currentStage,
							)}
							data-stage={stage}
							aria-current={isCurrent ? "step" : undefined}
						>
							<span>{isCurrent ? (data.stage ?? stage) : stage}</span>
							{isCurrent ? (
								<span className={clsx(panel.key)}>{currentStageLabel}</span>
							) : null}
							{visits === 0 ? null : (
								<span className={clsx(panel.key)}>
									{stageVisitsLabel(visits)}
								</span>
							)}
							{retries === 0 ? null : (
								<span className={clsx(panel.key)}>
									{stageRetriesLabel(retries)}
								</span>
							)}
							{usage === undefined ? null : (
								<span className={clsx(panel.stageUsage)}>
									{stageUsageLabel(usage)}
								</span>
							)}
						</li>
					);
				})}
			</ul>
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
