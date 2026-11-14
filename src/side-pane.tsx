import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useRef } from "react";

import { Button } from "./button.tsx";
import { menuOwnsEscape } from "./focus.ts";
import { colours, measure, radius, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	pane: {
		display: "flex",
		flexDirection: "column",
		flexShrink: 0,
		gap: space.sm,
		boxSizing: "border-box",
		width: measure.stagePane,
		maxWidth: "100%",
		maxHeight: measure.runGraph,
		padding: space.md,
		overflowY: "auto",
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
	},
	head: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: space.sm,
	},
});

type DataAttributes = { [name: `data-${string}`]: string };

/**
 * A framed pane beside a graph: a head row that ends in a close button, then the body.
 * Escape closes it.
 */
export function SidePane({
	label,
	closeLabel,
	onClose,
	head,
	children,
	...data
}: {
	label: string;
	closeLabel: string;
	onClose: () => void;
	/** The content at the start of the head row. */
	head: ReactNode;
	children: ReactNode;
} & DataAttributes) {
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (
				event.key !== "Escape" ||
				event.defaultPrevented ||
				event.ctrlKey ||
				event.metaKey ||
				menuOwnsEscape()
			) {
				return;
			}
			event.preventDefault();
			onCloseRef.current();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	return (
		<aside className={clsx(styles.pane)} aria-label={label} {...data}>
			<div className={clsx(styles.head)}>
				{head}
				<Button icon="x" name={closeLabel} onClick={onClose} />
			</div>
			{children}
		</aside>
	);
}
