import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import {
	liveRunStatusKinds,
	type ShownFactoryRun,
	type TranscriptEntry,
} from "./domain.ts";
import { Loading } from "./loading.tsx";
import { commentTime } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { NotServed } from "./run-checkpoint.tsx";
import { StageCard, type StageFacts } from "./run-stage.tsx";
import { stageQuery } from "./stage-queries.ts";
import {
	noRunDataLabel,
	noTranscriptLabel,
	runContextData,
	runContextHelp,
	runContextLabel,
	stageTranscriptData,
	stageTranscriptLabel,
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
				) : null}
				<time dateTime={entry.at}>{commentTime(entry.at)}</time>
			</span>
			{entry.kind === "message" ? (
				<p className={clsx(styles.text)}>{entry.text}</p>
			) : (
				<pre className={clsx(styles.code)}>{entry.input}</pre>
			)}
		</li>
	);
}

/** The stage transcript of one stage. A live stage reads its new entries again on an interval. */
function Transcript({
	runId,
	stage,
	live,
}: {
	runId: string;
	stage: string;
	live: boolean;
}) {
	const { data } = useQuery(stageQuery.transcript(runId, stage, live));
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
					className={clsx(styles.entries)}
					data-transcript={stage}
					data-transcript-next={data.next}
				>
					{data.entries.map((entry) => (
						<Entry key={entry.id} entry={entry} />
					))}
				</ol>
			)}
		</section>
	);
}

function shownValue(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** The context values of the run. The factory serves no context for one stage. */
function RunContext({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(stageQuery.context(run));
	return (
		<section aria-label={runContextLabel} title={runContextHelp}>
			<h4 className={clsx(panel.sectionLabel)}>{runContextLabel}</h4>
			{data === undefined ? (
				<Loading />
			) : data === "not served" ? (
				<NotServed data={runContextData} />
			) : data === "missing" || Object.keys(data).length === 0 ? (
				<p className={clsx(panel.note)}>{noRunDataLabel}</p>
			) : (
				<dl className={clsx(styles.context)} data-run-context="">
					{Object.entries(data).map(([key, value]) => (
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
		facts.stage.state === "current" &&
		liveRunStatusKinds.some((kind) => kind === run.statusKind)
	);
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
			{"child" in facts.stage ? null : (
				<Transcript
					runId={run.id}
					stage={facts.stage.id}
					live={isLiveStage(run, facts)}
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
