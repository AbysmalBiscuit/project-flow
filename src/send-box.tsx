import type { ComponentPropsWithoutRef, KeyboardEvent } from "react";

import { Button } from "./button.tsx";
import { panel } from "./panel-styles.ts";
import { clsx } from "./ui.ts";

const sendKey = "Ctrl+Enter";

/**
 * Escape blurs a panel text box and keeps its draft, so only a second Escape
 * reaches the side panel and closes it. True when it took the key.
 */
export function blurOnEscape(
	event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
): boolean {
	if (
		event.key !== "Escape" ||
		event.ctrlKey ||
		event.metaKey ||
		event.nativeEvent.isComposing
	) {
		return false;
	}
	event.preventDefault();
	event.currentTarget.blur();
	return true;
}

/** Ctrl+Enter or Cmd+Enter sends the form, the same as a click on its send button. */
function sendBoxKeys(event: KeyboardEvent<HTMLTextAreaElement>): void {
	if (blurOnEscape(event) || event.nativeEvent.isComposing) {
		return;
	}
	// `requestSubmit` submits even when the submitter is disabled, so check it here.
	// A held key repeats, and the repeats must not send again.
	if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) {
		return;
	}
	event.preventDefault();
	const form = event.currentTarget.form;
	const submit = form?.querySelector<HTMLButtonElement>(
		'button[type="submit"]',
	);
	if (event.repeat || form == null || submit == null || submit.disabled) {
		return;
	}
	form.requestSubmit(submit);
}

/** A panel text box that its form's send button or the send key sends. */
export function SendText(
	props: Omit<ComponentPropsWithoutRef<"textarea">, "className" | "onKeyDown">,
) {
	return (
		<textarea {...props} className={clsx(panel.text)} onKeyDown={sendBoxKeys} />
	);
}

/** The submit button of a `SendText` form. Its tooltip names the send key. */
export function SendButton({
	label,
	disabled,
}: {
	label: string;
	disabled: boolean;
}) {
	return (
		<Button
			label={label}
			tooltip={`${label} (${sendKey})`}
			submit
			tone="primary"
			layout={panel.send}
			disabled={disabled}
		/>
	);
}
