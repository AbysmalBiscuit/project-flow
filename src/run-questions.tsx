import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import type { FactoryQuestion } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { useAnswerQuestion } from "./run-mutations.ts";
import { SendButton, SendText } from "./send-box.tsx";
import { answerFailed, runQuestionsLabel } from "./terms.ts";
import { actionToastHideMs, Toast } from "./toast.tsx";
import { space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	answer: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
		marginBottom: space.md,
	},
});

function QuestionAnswer({
	run,
	question,
}: {
	run: string;
	question: FactoryQuestion;
}) {
	const [draft, setDraft] = useState("");
	const answer = useAnswerQuestion(run, question.id);
	const field = `run-question-${question.id}`;
	return (
		<form
			className={clsx(styles.answer)}
			data-run-question={question.id}
			onSubmit={(event) => {
				event.preventDefault();
				if (draft.trim() === "") {
					return;
				}
				answer.mutate(draft, { onSuccess: () => setDraft("") });
			}}
		>
			<label className={clsx(panel.question)} htmlFor={field}>
				{question.text}
			</label>
			<SendText
				id={field}
				placeholder="Write an answer"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
			/>
			<SendButton label="Answer" disabled={answer.isPending} />
			{answer.error === null ? null : (
				<Toast
					tone="error"
					message={`${answerFailed}: ${answer.error.message}`}
					hideMs={actionToastHideMs}
					onClose={() => answer.reset()}
				/>
			)}
		</form>
	);
}

/** The open questions of a blocked run, each with an answer box that posts to the factory. */
export function RunQuestions({
	run,
	questions,
}: {
	run: string;
	questions: FactoryQuestion[];
}) {
	return (
		<section className={clsx(panel.section)} aria-label={runQuestionsLabel}>
			<h3 className={clsx(panel.sectionLabel)}>{runQuestionsLabel}</h3>
			{questions.map((question) => (
				<QuestionAnswer key={question.id} run={run} question={question} />
			))}
		</section>
	);
}
