import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useId, useState, useSyncExternalStore } from "react";
import { z } from "zod";

import { Button, type IconName } from "./button.tsx";
import { floatPanelLabel } from "./terms.ts";
import {
	colours,
	measure,
	radius,
	space,
	stack,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

export const float = stylex.create({
	pane: {
		margin: `calc(-1 * ${space.sm})`,
	},
	overlay: {
		position: "absolute",
		zIndex: stack.panel,
		top: 0,
		right: 0,
		left: 0,
		display: "flex",
		flexWrap: "wrap",
		alignItems: "flex-start",
		gap: space.sm,
		containerType: "inline-size",
		pointerEvents: "none",
	},
	corner: {
		position: "absolute",
		zIndex: stack.panel,
		right: 0,
		bottom: 0,
		left: 0,
		display: "flex",
		alignItems: "flex-end",
		containerType: "inline-size",
		pointerEvents: "none",
	},
	group: {
		display: "flex",
		flex: "0 1 auto",
		flexWrap: "wrap",
		gap: space.xs,
		alignItems: "center",
		minWidth: 0,
		maxWidth: "100%",
	},
});

const panel = stylex.create({
	shell: {
		position: "relative",
		display: "flex",
		pointerEvents: "auto",
	},
	button: {
		display: "flex",
		opacity: measure.restOpacity,
		transitionProperty: "opacity",
		transitionDuration: measure.fade,
	},
	buttonHidden: {
		opacity: 0,
	},
	body: {
		position: "absolute",
		left: 0,
		display: "flex",
		gap: space.xs,
		width: "max-content",
		minWidth: "100%",
		minHeight: "100%",
		maxWidth: "100cqw",
		boxSizing: "border-box",
		padding: space.sm,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.sm,
		backgroundColor: colours.raised,
		color: colours.inkSoft,
		fontSize: type.meta,
		opacity: 0,
		pointerEvents: "none",
		transitionProperty: "opacity, clip-path",
		transitionDuration: measure.fade,
		transitionTimingFunction: "ease-out",
	},
	down: {
		top: 0,
		clipPath: "inset(0 100% 100% 0)",
	},
	up: {
		bottom: 0,
		clipPath: "inset(100% 100% 0 0)",
	},
	bodyOpen: {
		opacity: 1,
		clipPath: "inset(0)",
		pointerEvents: "auto",
	},
	pinCentre: {
		alignSelf: "center",
	},
	pinEnd: {
		alignSelf: "flex-end",
	},
});

const pinKey = "project-flow.pinned";

const pinShape = z.record(z.string(), z.boolean()).catch({});

function readPins(): z.infer<typeof pinShape> {
	try {
		const raw = window.localStorage.getItem(pinKey);
		return raw === null ? {} : pinShape.parse(JSON.parse(raw));
	} catch {
		return {};
	}
}

let pins = readPins();
const pinListeners = new Set<() => void>();

function subscribePins(listener: () => void): () => void {
	pinListeners.add(listener);
	return () => pinListeners.delete(listener);
}

function setPin(id: string, pinned: boolean): void {
	pins = { ...pins, [id]: pinned };
	try {
		window.localStorage.setItem(pinKey, JSON.stringify(pins));
	} catch {}
	for (const listener of pinListeners) {
		listener();
	}
}

/**
 * A faded button that expands into its panel on hover or keyboard focus, or stays open when pinned.
 * The browser keeps the pin by `id`.
 * The open panel covers the button and keeps the button's corner fixed: `down` grows from the top-left corner, `up` from the bottom-left.
 * The panel floats over the page, so the box of the panel never changes size.
 * `pin` puts the pin button `first` in the content row, or `last` at the bottom right.
 */
export function FloatPanel({
	id,
	label,
	icon,
	grow,
	pin: pinAt,
	layout,
	children,
}: {
	id: string;
	label: string;
	icon: IconName;
	grow: "down" | "up";
	pin: "first" | "last";
	layout?: stylex.StyleXStyles;
	children: ReactNode;
}) {
	const pinned = useSyncExternalStore(subscribePins, () => pins[id] === true);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const bodyId = useId();
	const open = pinned || hovered || focused;
	const pin = (
		<Button
			icon={pinned ? "pin-off" : "pin"}
			name={pinned ? floatPanelLabel.unpin(label) : floatPanelLabel.pin(label)}
			pressed={pinned}
			layout={pinAt === "last" ? panel.pinEnd : panel.pinCentre}
			onClick={() => setPin(id, !pinned)}
		/>
	);
	return (
		<section
			id={id}
			aria-label={label}
			data-open={open ? "open" : "closed"}
			data-pinned={pinned ? "pinned" : "loose"}
			className={clsx(panel.shell)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={(event) => {
				// A mouse click focuses a button too; only keyboard focus opens.
				if (event.target.matches(":focus-visible")) {
					setFocused(true);
				}
			}}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					setFocused(false);
				}
			}}
		>
			<div className={clsx(panel.button, open && panel.buttonHidden)}>
				<Button
					icon={icon}
					label={label}
					aria-expanded={open}
					aria-controls={bodyId}
					onClick={() => setPin(id, !pinned)}
				/>
			</div>
			<div
				id={bodyId}
				data-float-body=""
				inert={!open}
				className={clsx(
					panel.body,
					grow === "down" ? panel.down : panel.up,
					open && panel.bodyOpen,
					layout,
				)}
			>
				{pinAt === "first" ? pin : null}
				{children}
				{pinAt === "last" ? pin : null}
			</div>
		</section>
	);
}
