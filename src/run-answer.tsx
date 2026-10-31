import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { useAnswerQuestion } from "./run-mutations.ts";
import { SendButton, SendText } from "./send-box.tsx";
import { answerFailed } from "./terms.ts";
import { actionToastHideMs, Toast } from "./toast.tsx";
import { space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	answer: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
		marginTop: space.sm,
	},
});

/** The answer box of an open ask, under the ask in the run thread. It posts to the factory. */
export function RunAnswer({
	run,
	question,
	askId,
}: {
	run: string;
	question: string;
	/** The id of the element that shows the ask, which labels the answer box. */
	askId: string;
}) {
	const [draft, setDraft] = useState("");
	const answer = useAnswerQuestion(run, question);
	return (
		<form
			className={clsx(styles.answer)}
			data-run-question={question}
			onSubmit={(event) => {
				event.preventDefault();
				if (draft.trim() === "") {
					return;
				}
				answer.mutate(draft, { onSuccess: () => setDraft("") });
			}}
		>
			<SendText
				aria-labelledby={askId}
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
