import { useRef, useState } from "react";

import { textControl } from "./control-styles.ts";
import { panel } from "./panel-styles.ts";
import { Toast, toastHideMs } from "./toast.tsx";
import { clsx } from "./ui.ts";

const copyKeyCopy = {
	action: (key: string) => `Copy ${key}`,
	copied: "Copied",
	failed: "Copy failed",
} as const;

type Outcome = { id: number; tone: "saved" | "error"; message: string };

/** A ticket key that copies itself to the clipboard on a click or on Enter. */
export function CopyKey({ ticketKey }: { ticketKey: string }) {
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const copies = useRef(0);
	async function copy(): Promise<void> {
		copies.current += 1;
		const id = copies.current;
		try {
			await navigator.clipboard.writeText(ticketKey);
			setOutcome({ id, tone: "saved", message: copyKeyCopy.copied });
		} catch (cause) {
			const reason = cause instanceof Error ? `: ${cause.message}` : "";
			setOutcome({
				id,
				tone: "error",
				message: `${copyKeyCopy.failed}${reason}`,
			});
		}
	}
	return (
		<>
			<button
				type="button"
				className={clsx(
					panel.key,
					panel.headKey,
					...textControl,
					panel.copyKey,
				)}
				title={copyKeyCopy.action(ticketKey)}
				aria-label={copyKeyCopy.action(ticketKey)}
				data-copy-key={ticketKey}
				onClick={() => {
					void copy();
				}}
			>
				{ticketKey}
			</button>
			{outcome === null ? null : (
				<Toast
					key={outcome.id}
					tone={outcome.tone}
					message={outcome.message}
					hideMs={toastHideMs(outcome.tone)}
					onClose={() => setOutcome(null)}
				/>
			)}
		</>
	);
}
