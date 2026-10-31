import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useRef } from "react";

import type { ShownFactoryRun, TranscriptEntry } from "./domain.ts";
import { liveRunStatusKinds } from "./kinds.ts";
import { Loading } from "./loading.tsx";
import { commentTime } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { NotServed } from "./run-checkpoint.tsx";
import { isRunAt, StageCard, type StageFacts } from "./run-stage.tsx";
import { stageQuery, stageVisit } from "./stage-queries.ts";
import {
	noRunDataLabel,
	noTranscriptLabel,
	runContextData,
	runContextHelp,
	runContextLabel,
	stageTranscriptData,
	stageTranscriptLabel,
	steerEntryLabel,
	terminalEndedLabel,
	toolCallLabel,
} from "./terms.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	view: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
		minWidth: 0,
	},
	entries: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
		maxHeight: measure.transcript,
		margin: 0,
		padding: 0,
		overflowY: "auto",
		listStyle: "none",
	},
	entry: {
		display: "flex",
		flexDirection: "column",
		gap: space.twoXs,
		paddingBlock: space.xs,
		paddingInline: space.sm,
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		fontSize: type.meta,
		lineHeight: type.line,
	},
	meta: {
		display: "flex",
		gap: space.sm,
		color: colours.inkSoft,
	},
	tool: {
		color: colours.accent,
		fontWeight: type.weight,
	},
	steer: {
		color: colours.ink,
		fontWeight: type.weight,
	},
	text: {
		margin: 0,
		color: colours.ink,
		overflowWrap: "anywhere",
		whiteSpace: "pre-wrap",
	},
	code: {
		margin: 0,
		color: colours.ink,
		fontFamily: font.mono,
		overflowWrap: "anywhere",
		whiteSpace: "pre-wrap",
	},
	context: {
		display: "grid",
		gridTemplateColumns: "max-content minmax(0, 1fr)",
		columnGap: space.md,
		rowGap: space.xs,
		margin: 0,
		fontSize: type.meta,
		lineHeight: type.line,
	},
	contextKey: {
		color: colours.inkMuted,
	},
	contextValue: {
		margin: 0,
		color: colours.ink,
		fontFamily: font.mono,
		overflowWrap: "anywhere",
		whiteSpace: "pre-wrap",
	},
});

function Entry({ entry }: { entry: TranscriptEntry }) {
	return (
		<li
			className={clsx(styles.entry)}
			data-transcript-entry={entry.id}
			data-entry-kind={entry.kind}
		>
			<span className={clsx(styles.meta)}>
				{entry.kind === "tool_call" ? (
					<span className={clsx(styles.tool)}>
						{toolCallLabel(entry.name, entry.truncated)}
					</span>
				) : entry.kind === "steer" ? (
					<span className={clsx(styles.steer)}>
						{steerEntryLabel(entry.sender, entry.interrupt)}
					</span>
				) : null}
				<time dateTime={entry.at}>{commentTime(entry.at)}</time>
			</span>
			{entry.kind === "tool_call" ? (
				<pre className={clsx(styles.code)}>{entry.input}</pre>
			) : (
				<p className={clsx(styles.text)}>{entry.text}</p>
			)}
		</li>
	);
}

/**
 * A pane worker records a steer as it reaches the worker, and the messages of
 * a turn as the turn runs, so the cursor order can differ from the time order.
 */
function byRecordedTime(a: TranscriptEntry, b: TranscriptEntry): number {
	return Date.parse(a.at) - Date.parse(b.at);
}

/**
 * The stage transcript of one stage. A live stage reads its new entries again
 * on an interval. With `follow`, the list scrolls to each new entry.
 */
export function Transcript({
	runId,
	stage,
	live,
	visit,
	follow = false,
}: {
	runId: string;
	stage: string;
	live: boolean;
	visit: string;
	follow?: boolean;
}) {
	const { data } = useQuery(stageQuery.transcript(runId, stage, live, visit));
	const list = useRef<HTMLOListElement>(null);
	const next = typeof data === "object" ? data.next : null;
	useEffect(() => {
		if (follow && next !== null) {
			list.current?.scrollTo({ top: list.current.scrollHeight });
		}
	}, [follow, next]);
	return (
		<section aria-label={stageTranscriptLabel}>
			<h4 className={clsx(panel.sectionLabel)}>{stageTranscriptLabel}</h4>
			{data === undefined ? (
				<Loading />
			) : data === "not served" ? (
				<NotServed data={stageTranscriptData} />
			) : data === "missing" ? (
				<p className={clsx(panel.note)}>{noRunDataLabel}</p>
			) : data.entries.length === 0 ? (
				<p className={clsx(panel.note)}>{noTranscriptLabel}</p>
			) : (
				<ol
					ref={list}
					className={clsx(styles.entries)}
					data-transcript={stage}
					data-transcript-next={data.next}
					data-transcript-ended={data.ended}
				>
					{data.entries.toSorted(byRecordedTime).map((entry) => (
						<Entry key={entry.id} entry={entry} />
					))}
				</ol>
			)}
			{follow && typeof data === "object" && data.ended ? (
				<p className={clsx(panel.note)}>{terminalEndedLabel}</p>
			) : null}
		</section>
	);
}

function shownValue(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** The context values of the run, from its checkpoint. The factory serves no context for one stage. */
function RunContext({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	return (
		<section aria-label={runContextLabel} title={runContextHelp}>
			<h4 className={clsx(panel.sectionLabel)}>{runContextLabel}</h4>
			{data === undefined ? (
				<Loading />
			) : data === "not served" ? (
				<NotServed data={runContextData} />
			) : data === "missing" || Object.keys(data.context).length === 0 ? (
				<p className={clsx(panel.note)}>{noRunDataLabel}</p>
			) : (
				<dl className={clsx(styles.context)} data-run-context="">
					{Object.entries(data.context).map(([key, value]) => (
						<Fragment key={key}>
							<dt className={clsx(styles.contextKey)}>{key}</dt>
							<dd className={clsx(styles.contextValue)}>{shownValue(value)}</dd>
						</Fragment>
					))}
				</dl>
			)}
		</section>
	);
}

/** True while the run is live and `facts` is the stage where it is now. */
export function isLiveStage(run: ShownFactoryRun, facts: StageFacts): boolean {
	return (
		isRunAt(facts.stage) &&
		liveRunStatusKinds.some((kind) => kind === run.statusKind)
	);
}

/**
 * The node path that a steer from the view of `facts` reaches: the stage
 * itself, or the live stage of the child graph that it calls. Null when the
 * run is not live there, or when `currentStage`, the path where the run is
 * now, has moved elsewhere.
 */
export function steerTarget(
	run: ShownFactoryRun,
	facts: StageFacts,
	currentStage: string | null,
): string | null {
	if (!isLiveStage(run, facts)) {
		return null;
	}
	const target =
		facts.stage.child === undefined
			? facts.stage.id
			: facts.stage.child.findLast(isRunAt)?.id;
	return target === currentStage ? target : null;
}

/**
 * The stage transcript and the run context of one stage, under its stage card.
 * A stage that calls a child graph has no agent of its own, so it shows no transcript.
 */
export function StageDetail({
	run,
	facts,
}: {
	run: ShownFactoryRun;
	facts: StageFacts;
}) {
	return (
		<div className={clsx(styles.view)} data-stage-view={facts.stage.id}>
			{facts.stage.child !== undefined ? null : (
				<Transcript
					runId={run.id}
					stage={facts.stage.id}
					live={isLiveStage(run, facts)}
					visit={stageVisit(run.statusKind, facts.stage.visits)}
				/>
			)}
			<RunContext run={run} />
		</div>
	);
}

/** The stage view: the facts, the stage transcript and the run context of one stage. */
export function StageView({
	run,
	facts,
}: {
	run: ShownFactoryRun;
	facts: StageFacts;
}) {
	return (
		<div className={clsx(styles.view)}>
			<StageCard facts={facts} boxed />
			<StageDetail run={run} facts={facts} />
		</div>
	);
}
