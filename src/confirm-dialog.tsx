import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";

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
	actions: {
		display: "flex",
		gap: space.sm,
		justifyContent: "flex-end",
	},
});

/**
 * A modal dialog that asks before a change. Escape and the dismiss button,
 * Cancel unless `dismissLabel` names it, both call `onCancel`.
 */
export function ConfirmDialog({
	id,
	open,
	title,
	body,
	confirmLabel,
	dismissLabel = settingsCopy.cancel,
	onConfirm,
	onCancel,
}: {
	id: string;
	open: boolean;
	title: string;
	body: string;
	confirmLabel: string;
	dismissLabel?: string;
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
		}
		if (!open && node.open) {
			node.close();
		}
	}, [open]);

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
			<h2 id={`${id}-title`} className={clsx(styles.title)}>
				{title}
			</h2>
			<p className={clsx(styles.body)}>{body}</p>
			<div className={clsx(styles.actions)}>
				<Button id={`${id}-cancel`} label={dismissLabel} onClick={onCancel} />
				<Button
					id={`${id}-confirm`}
					label={confirmLabel}
					tone="danger"
					onClick={onConfirm}
				/>
			</div>
		</dialog>
	);
}
