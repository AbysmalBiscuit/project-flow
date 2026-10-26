import * as stylex from "@stylexjs/stylex";

import { endedRunStatusKinds, type ShownFactoryRun } from "./domain.ts";
import { commentTime } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { RunQuestions } from "./run-questions.tsx";
import { RunSteer } from "./run-steer.tsx";
import { runMessageLabel, runThreadLabel } from "./terms.ts";
import { colours, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	text: {
		margin: 0,
		color: colours.ink,
		fontSize: type.meta,
		lineHeight: type.line,
		whiteSpace: "pre-wrap",
	},
});

/**
 * The talk with a run, like a chat: its asks, answers and delivered steers in time order,
 * then an answer box for each open ask and the steer box of a live run.
 */
export function RunThread({ run }: { run: ShownFactoryRun }) {
	const thread = run.thread ?? [];
	const questions = run.questions ?? [];
	const live = !endedRunStatusKinds.some((kind) => kind === run.statusKind);
	if (thread.length === 0 && questions.length === 0 && !live) {
		return null;
	}
	return (
		<section className={clsx(panel.section)} aria-label={runThreadLabel}>
			<h3 className={clsx(panel.sectionLabel)}>{runThreadLabel}</h3>
			{thread.length === 0 ? null : (
				<ul className={clsx(panel.thread)}>
					{thread.map((message) => (
						<li
							key={`${message.kind} ${message.at} ${message.text}`}
							className={clsx(panel.comment)}
							data-run-message={message.kind}
						>
							<p className={clsx(panel.who)}>
								<span>
									{message.sender} {runMessageLabel[message.kind]}
								</span>
								<span>{commentTime(message.at)}</span>
							</p>
							<p className={clsx(styles.text)}>{message.text}</p>
						</li>
					))}
				</ul>
			)}
			{questions.length === 0 ? null : (
				<RunQuestions run={run.id} questions={questions} />
			)}
			{live ? <RunSteer run={run} /> : null}
		</section>
	);
}
