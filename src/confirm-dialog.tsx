import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useRef } from "react";

import { Button } from "./button.tsx";
import { settingsCopy } from "./terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	dialog: {
		boxSizing: "border-box",
		width: measure.dialog,
		maxWidth: `calc(100vw - 2 * ${space.lg})`,
		padding: space.lg,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
		boxShadow: `0 0 ${space.xl} ${colours.shadow}`,
		color: colours.ink,
		"::backdrop": {
			backgroundColor: colours.shadow,
		},
	},
	title: {
		margin: `0 0 ${space.sm}`,
		fontSize: type.heading,
		fontWeight: type.weight,
	},
	body: {
		margin: `0 0 ${space.lg}`,
		color: colours.inkMuted,
		fontSize: type.menu,
	},
	fields: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
		margin: `0 0 ${space.lg}`,
	},
	actions: {
		display: "flex",
		gap: space.sm,
		justifyContent: "flex-end",
	},
});

/**
 * A modal dialog that asks before a change. Escape and the dismiss button,
 * Cancel unless `dismissLabel` names it, both call `onCancel`. The dialog is
 * a form, and its confirm button submits it. `children` sit between the body
 * and the buttons, such as a text field that `confirmDisabled` waits for. The
 * first field of `children` holds the focus when the dialog opens, else the
 * confirm button does, so Enter confirms.
 */
export function ConfirmDialog({
	id,
	open,
	title,
	body,
	confirmLabel,
	dismissLabel = settingsCopy.cancel,
	confirmDisabled = false,
	children,
	onConfirm,
	onCancel,
}: {
	id: string;
	open: boolean;
	title: string;
	body: string;
	confirmLabel: string;
	dismissLabel?: string;
	confirmDisabled?: boolean;
	children?: ReactNode;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const node = dialog.current;
		if (node === null) {
			return;
		}
		if (open && !node.open) {
			node.showModal();
			const field = node.querySelector<HTMLElement>("input, textarea, select");
			(field ?? document.getElementById(`${id}-confirm`))?.focus();
		}
		if (!open && node.open) {
			node.close();
		}
	}, [open, id]);

	return (
		<dialog
			ref={dialog}
			id={id}
			aria-labelledby={`${id}-title`}
			className={clsx(styles.dialog)}
			onCancel={(event) => {
				event.preventDefault();
				onCancel();
			}}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm();
				}}
			>
				<h2 id={`${id}-title`} className={clsx(styles.title)}>
					{title}
				</h2>
				<p className={clsx(styles.body)}>{body}</p>
				{children === undefined ? null : (
					<div className={clsx(styles.fields)}>{children}</div>
				)}
				<div className={clsx(styles.actions)}>
					<Button id={`${id}-cancel`} label={dismissLabel} onClick={onCancel} />
					<Button
						id={`${id}-confirm`}
						label={confirmLabel}
						tone="danger"
						disabled={confirmDisabled}
						submit
					/>
				</div>
			</form>
		</dialog>
	);
}
