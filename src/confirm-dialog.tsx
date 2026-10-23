import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { settingsCopy } from "./terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { shell } from "./ui-styles.ts";

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
	confirm: {
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.danger,
		borderRadius: radius.menu,
		padding: `${space.xs} ${space.md}`,
		backgroundColor: colours.danger,
		color: colours.accentInk,
		fontSize: type.menu,
		fontWeight: type.weight,
		lineHeight: 1,
		cursor: "pointer",
	},
});

/**
 * A modal dialog that asks before a change. Escape and Cancel both call
 * `onCancel`.
 */
export function ConfirmDialog({
	id,
	open,
	title,
	body,
	confirmLabel,
	onConfirm,
	onCancel,
}: {
	id: string;
	open: boolean;
	title: string;
	body: string;
	confirmLabel: string;
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
				<button
					id={`${id}-cancel`}
					type="button"
					className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
					onClick={onCancel}
				>
					{settingsCopy.cancel}
				</button>
				<button
					id={`${id}-confirm`}
					type="button"
					className={clsx(styles.confirm, shell.buttonFocus)}
					onClick={onConfirm}
				>
					{confirmLabel}
				</button>
			</div>
		</dialog>
	);
}
