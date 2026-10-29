import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { RunDetail } from "./domain.ts";
import { Loading } from "./loading.tsx";
import { runPagePath } from "./page-links.ts";
import { commentTime, elapsed, RunFact, runTime } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { RunAction } from "./run-action.tsx";
import { RunArtifacts } from "./run-artifacts.tsx";
import { NotServed, RunStages, RunUsage } from "./run-checkpoint.tsx";
import { RunEvents } from "./run-events.tsx";
import { RunFiles } from "./run-files.tsx";
import { RunGraph } from "./run-graph.tsx";
import { RunDot } from "./run-marks.tsx";
import { RunRemove } from "./run-remove.tsx";
import { RunSandbox } from "./run-sandbox.tsx";
import { RunSettings } from "./run-settings.tsx";
import { RunSource } from "./run-source.tsx";
import { RunThread } from "./run-thread.tsx";
import { Segment } from "./segment.tsx";
import { PageFrame } from "./shell.tsx";
import {
	hubQueueLabel,
	runFactLabel,
	runMissingLabel,
	runPageLabel,
	runReadFailedLabel,
	runStatusLabel,
	type RunTab,
	runTabData,
	runTabLabel,
} from "./terms.ts";
import { colours, measure, radius, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	body: {
		display: "flex",
		flexDirection: "column",
		gap: space.md,
	},
	panel: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
	},
	text: {
		maxWidth: measure.diagram,
	},
	tabs: {
		display: "inline-flex",
		flexWrap: "wrap",
		alignSelf: "flex-start",
		gap: space.twoXs,
		padding: space.twoXs,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
	},
});

const runPath = "/runs/";

function runIdOf(pathname: string): string {
	try {
		return decodeURIComponent(pathname.slice(runPath.length));
	} catch {
		return "";
	}
}

function isRunTab(value: string | null): value is RunTab {
	return value !== null && Object.hasOwn(runTabLabel, value);
}

function tabOfUrl(): RunTab {
	const tab = new URLSearchParams(window.location.search).get("tab");
	return isRunTab(tab) ? tab : "overview";
}

/** The stage that the Stages tab opens at, from a stage pane link. */
function stageOfUrl(): string | null {
	return new URLSearchParams(window.location.search).get("stage");
}

function RunFacts({ run }: { run: RunDetail }) {
	const span = elapsed(run);
	const event = run.lastEvent;
	return (
		<dl className={clsx(panel.facts)}>
			<RunFact label={runFactLabel.status}>
				<span className={clsx(panel.runStatus)}>
					{run.coveredByFeed ? <RunDot run={run} /> : null}
					{runStatusLabel[run.statusKind]}
				</span>
			</RunFact>
			{run.restartedFrom === undefined ? null : (
				<RunFact label={runFactLabel.restartedFrom}>
					<a
						className={clsx(panel.factLink)}
						href={runPagePath(run.restartedFrom)}
						data-restarted-from={run.restartedFrom}
					>
						{run.restartedFrom}
					</a>
				</RunFact>
			)}
			{run.failureReason === undefined ? null : (
				<RunFact label={runFactLabel.failureReason}>
					{run.failureReason}
				</RunFact>
			)}
			{run.stage === undefined ? null : (
				<RunFact label={runFactLabel.stage}>{run.stage}</RunFact>
			)}
			<RunFact label={runFactLabel.ticket}>{run.key}</RunFact>
			{run.repo === undefined ? null : (
				<RunFact label={runFactLabel.project}>{run.repo}</RunFact>
			)}
			<RunFact label={runFactLabel.factory}>{run.factory}</RunFact>
			<RunFact label={runFactLabel.box}>{run.box ?? hubQueueLabel}</RunFact>
			{run.workflow === undefined ? null : (
				<RunFact label={runFactLabel.workflow}>{run.workflow}</RunFact>
			)}
			<RunFact label={runFactLabel.start}>{runTime(run.startedAt)}</RunFact>
			{span === null ? null : (
				<RunFact label={runFactLabel.elapsed}>{span}</RunFact>
			)}
			{event === undefined ? null : (
				<RunFact label={runFactLabel.lastEvent}>
					{event.event} {event.stage}
					{event.at === undefined ? null : ` ${commentTime(event.at)}`}
				</RunFact>
			)}
		</dl>
	);
}

function TabBody({
	run,
	tab,
	pick,
}: {
	run: RunDetail;
	tab: RunTab;
	pick: (next: RunTab, stage?: string) => void;
}) {
	if (tab === "overview") {
		return (
			<>
				<div className={clsx(styles.text)}>
					<RunFacts run={run} />
				</div>
				<RunGraph run={run} onOpenStage={(stage) => pick("stages", stage)} />
				<div className={clsx(styles.text)}>
					<RunThread run={run} />
				</div>
			</>
		);
	}
	return (
		<div className={clsx(styles.text)}>
			{tab === "stages" ? (
				<RunStages run={run} opened={stageOfUrl()} />
			) : tab === "usage" ? (
				<RunUsage run={run} />
			) : tab === "events" ? (
				<RunEvents run={run} />
			) : tab === "files" ? (
				<RunFiles run={run} onSandbox={() => pick("sandbox")} />
			) : tab === "artifacts" ? (
				<RunArtifacts run={run} />
			) : tab === "sandbox" ? (
				<RunSandbox run={run} />
			) : tab === "settings" ? (
				<RunSettings run={run} />
			) : tab === "source" ? (
				<RunSource run={run} />
			) : (
				<NotServed data={runTabData[tab]} />
			)}
		</div>
	);
}

/** The run page: the detail of one workcell run, in tabs. */
export function Page() {
	const id = runIdOf(window.location.pathname);
	const { data, isError } = useQuery(pageQuery.run(id));
	const [tab, setTab] = useState(tabOfUrl);
	const pick = (next: RunTab, stage?: string) => {
		setTab(next);
		const url = new URL(window.location.href);
		if (next === "overview") {
			url.searchParams.delete("tab");
		} else {
			url.searchParams.set("tab", next);
		}
		if (stage === undefined) {
			url.searchParams.delete("stage");
		} else {
			url.searchParams.set("stage", stage);
		}
		window.history.replaceState(null, "", url);
	};
	return (
		<PageFrame
			title={
				data === undefined || data === null
					? runPageLabel
					: `${runPageLabel} ${data.key}`
			}
			subtitle={id}
			{...(data === undefined || data === null
				? {}
				: {
						actions: (
							<>
								<RunAction run={data} />
								<RunRemove run={data} />
							</>
						),
					})}
		>
			<div className={clsx(styles.body)}>
				<div
					className={clsx(styles.tabs)}
					role="tablist"
					aria-label={runPageLabel}
				>
					{Object.entries(runTabLabel).map(([key, label]) =>
						isRunTab(key) ? (
							<Segment
								key={key}
								id={`run-tab-${key}`}
								role="tab"
								label={label}
								on={tab === key}
								onClick={() => pick(key)}
							/>
						) : null,
					)}
				</div>
				<section
					role="tabpanel"
					aria-labelledby={`run-tab-${tab}`}
					className={clsx(styles.panel)}
				>
					{data === undefined ? (
						isError ? (
							<p className={clsx(panel.note)}>{runReadFailedLabel}</p>
						) : (
							<Loading />
						)
					) : data === null ? (
						<p className={clsx(panel.note)}>{runMissingLabel}</p>
					) : (
						<TabBody run={data} tab={tab} pick={pick} />
					)}
				</section>
			</div>
		</PageFrame>
	);
}
