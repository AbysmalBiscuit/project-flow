import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "./button.tsx";
import { toastCloseLabel } from "./terms.ts";
import {
	colours,
	measure,
	radius,
	space,
	stack,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

/** How long a run action error stays before it hides. */
export const actionToastHideMs = 6_000;

const styles = stylex.create({
	toast: {
		position: "fixed",
		zIndex: stack.toast,
		bottom: space.lg,
		left: "50%",
		display: "flex",
		gap: space.sm,
		alignItems: "center",
		boxSizing: "border-box",
		width: "max-content",
		maxWidth: measure.toast,
		padding: `${space.xs} ${space.xs} ${space.xs} ${space.md}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
		boxShadow: `0 ${space.xs} ${space.md} ${colours.shadow}`,
		transform: "translateX(-50%)",
	},
	message: {
		flex: "1 1 auto",
		minWidth: 0,
		margin: 0,
		fontSize: type.menu,
		fontWeight: type.weight,
		overflowWrap: "anywhere",
	},
	saved: {
		color: colours.saved,
	},
	error: {
		color: colours.danger,
	},
});

/**
 * A message over the page that moves no other control. It stays until Lev
 * closes it, or until `hideMs` ends when given.
 */
export function Toast({
	id,
	message,
	tone,
	hideMs,
	onClose,
}: {
	id?: string;
	message: string;
	tone: "saved" | "error";
	hideMs?: number | undefined;
	onClose: () => void;
}) {
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useEffect(() => {
		if (hideMs === undefined) {
			return;
		}
		const hide = window.setTimeout(() => onCloseRef.current(), hideMs);
		return () => {
			window.clearTimeout(hide);
		};
	}, [hideMs]);
	return createPortal(
		<div
			id={id}
			className={clsx(styles.toast)}
			role={tone === "error" ? "alert" : "status"}
		>
			<p
				className={clsx(
					styles.message,
					tone === "error" ? styles.error : styles.saved,
				)}
			>
				{message}
			</p>
			<Button icon="x" name={toastCloseLabel} onClick={onClose} />
		</div>,
		document.body,
	);
}
