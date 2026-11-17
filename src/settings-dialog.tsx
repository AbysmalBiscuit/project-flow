import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useRef } from "react";

import { Button } from "./button.tsx";
import { settingsCopy } from "./settings-terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	dialog: {
		boxSizing: "border-box",
		width: measure.mappingDialog,
		maxWidth: `calc(100vw - 2 * ${space.lg})`,
		maxHeight: `calc(100dvh - 2 * ${space.xl})`,
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
		margin: `0 0 ${space.xs}`,
		fontSize: type.heading,
		fontWeight: type.weight,
	},
	lead: {
		margin: `0 0 ${space.md}`,
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	actions: {
		display: "flex",
		justifyContent: "flex-end",
		marginTop: space.lg,
	},
});

/** A modal that edits part of the settings draft. Done and Escape both close it. */
export function SettingsDialog({
	id,
	title,
	lead,
	children,
	onClose,
}: {
	id: string;
	title: string;
	lead: string;
	children: ReactNode;
	onClose: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	return (
		<dialog
			ref={dialog}
			id={id}
			aria-labelledby={`${id}-title`}
			className={clsx(styles.dialog)}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<h2 id={`${id}-title`} className={clsx(styles.title)}>
				{title}
			</h2>
			<p className={clsx(styles.lead)}>{lead}</p>
			{children}
			<div className={clsx(styles.actions)}>
				<Button
					id={`${id}-done`}
					label={settingsCopy.done}
					tone="primary"
					onClick={onClose}
				/>
			</div>
		</dialog>
	);
}
