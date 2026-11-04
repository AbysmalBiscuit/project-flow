import type * as stylex from "@stylexjs/stylex";
import { type ReactNode, useRef, useState } from "react";

import { textControl } from "./control-styles.ts";
import { copy } from "./copy-styles.ts";
import { copyTextCopy } from "./terms.ts";
import { actionToastHideMs, Toast } from "./toast.tsx";
import { clsx } from "./ui.ts";

type Outcome = { id: number; tone: "saved" | "error"; message: string };

/**
 * A button that copies `text` to the clipboard on a click or on Enter, and
 * shows the outcome in a toast. `name` names the copied thing in the labels.
 * `children` replace the shown text. The text control bleed and the copy base
 * apply over `style`.
 */
export function CopyText({
	text,
	name,
	children,
	style,
}: {
	text: string;
	name?: string;
	children?: ReactNode;
	style?: stylex.StyleXStyles;
}) {
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const copies = useRef(0);
	const label = copyTextCopy.action(text, name);
	async function write(): Promise<void> {
		copies.current += 1;
		const id = copies.current;
		try {
			await navigator.clipboard.writeText(text);
			setOutcome({ id, tone: "saved", message: copyTextCopy.copied });
		} catch (cause) {
			const reason = cause instanceof Error ? `: ${cause.message}` : "";
			setOutcome({
				id,
				tone: "error",
				message: `${copyTextCopy.failed}${reason}`,
			});
		}
	}
	return (
		<>
			<button
				type="button"
				className={clsx(style, ...textControl, copy.text)}
				title={label}
				aria-label={label}
				onClick={() => {
					void write();
				}}
			>
				{children ?? text}
			</button>
			{outcome === null ? null : (
				<Toast
					key={outcome.id}
					tone={outcome.tone}
					message={outcome.message}
					hideMs={actionToastHideMs}
					onClose={() => setOutcome(null)}
				/>
			)}
		</>
	);
}
