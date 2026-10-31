import { useId } from "react";

import { CommentMarkdown } from "./comment-markdown.tsx";
import {
	endedRunStatusKinds,
	type RunMessage,
	type ShownFactoryRun,
} from "./domain.ts";
import { commentTime } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { RunAnswer } from "./run-answer.tsx";
import { RunSteer } from "./run-steer.tsx";
import { runMessageLabel, runThreadLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

function ThreadMessage({
	run,
	message,
	openQuestion,
}: {
	run: string;
	message: RunMessage;
	/** The id of the ask when the run still waits on it. */
	openQuestion: string | undefined;
}) {
	const bodyId = useId();
	return (
		<li className={clsx(panel.comment)} data-run-message={message.kind}>
			<p className={clsx(panel.who)}>
				<span>
					{message.sender} {runMessageLabel[message.kind]}
				</span>
				<span>{commentTime(message.at)}</span>
			</p>
			<div id={bodyId}>
				<CommentMarkdown html={message.html} />
			</div>
			{openQuestion === undefined ? null : (
				<RunAnswer run={run} question={openQuestion} askId={bodyId} />
			)}
		</li>
	);
}

/**
 * The talk with a run, like a chat: its asks, answers and delivered steers in time order,
 * an answer box under each open ask, and the steer box of a live run.
 */
export function RunThread({ run }: { run: ShownFactoryRun }) {
	const thread = run.thread ?? [];
	const open = new Set(run.questions?.map(({ id }) => id));
	const live = !endedRunStatusKinds.some((kind) => kind === run.statusKind);
	if (thread.length === 0 && !live) {
		return null;
	}
	return (
		<section className={clsx(panel.section)} aria-label={runThreadLabel}>
			<h3 className={clsx(panel.sectionLabel)}>{runThreadLabel}</h3>
			{thread.length === 0 ? null : (
				<ul className={clsx(panel.thread)}>
					{thread.map((message) => (
						<ThreadMessage
							key={`${message.kind} ${message.at} ${message.text}`}
							run={run.id}
							message={message}
							openQuestion={
								message.question !== undefined && open.has(message.question)
									? message.question
									: undefined
							}
						/>
					))}
				</ul>
			)}
			{live ? <RunSteer run={run} /> : null}
		</section>
	);
}
