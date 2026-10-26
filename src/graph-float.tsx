import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useId, useState, useSyncExternalStore } from "react";
import { z } from "zod";

import { board } from "./board-styles.ts";
import { Button, type IconName } from "./button.tsx";
import { pageQuery } from "./queries.ts";
import { tonedProps } from "./state-tone.ts";
import { floatPanelLabel, projectGraphLabel } from "./terms.ts";
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
		pointerEvents: "none",
	},
	corner: {
		position: "absolute",
		zIndex: stack.panel,
		bottom: 0,
		left: 0,
		display: "flex",
		maxWidth: "100%",
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
		display: "flex",
		flexDirection: "column",
		alignItems: "flex-start",
		gap: space.xs,
		minWidth: 0,
		maxWidth: "100%",
		opacity: measure.restOpacity,
		transitionProperty: "opacity",
		transitionDuration: measure.fade,
		pointerEvents: "auto",
	},
	up: {
		flexDirection: "column-reverse",
	},
	shellOpen: {
		opacity: 1,
	},
	reveal: {
		display: "grid",
		gridTemplateRows: "0fr",
		gridTemplateColumns: "0fr",
		maxWidth: "100%",
		transitionProperty: "grid-template-rows, grid-template-columns",
		transitionDuration: measure.fade,
		transitionTimingFunction: "ease-out",
	},
	revealOpen: {
		gridTemplateRows: "1fr",
		gridTemplateColumns: "1fr",
	},
	clip: {
		minWidth: 0,
		minHeight: 0,
		overflow: "hidden",
	},
	body: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
		width: "max-content",
		maxWidth: "100%",
		boxSizing: "border-box",
		padding: space.sm,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.sm,
		backgroundColor: colours.raised,
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	pinStart: {
		alignSelf: "flex-start",
	},
	pinEnd: {
		alignSelf: "flex-end",
	},
	legend: {
		maxWidth: measure.legendCap,
	},
	legendList: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
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
 * A faded button that opens to its panel on hover or keyboard focus, or stays open when pinned.
 * The browser keeps the pin by `id`. A `bottom` panel opens upward, with its pin top-right.
 */
export function FloatPanel({
	id,
	label,
	icon,
	edge,
	layout,
	children,
}: {
	id: string;
	label: string;
	icon: IconName;
	edge: "top" | "bottom";
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
			layout={edge === "top" ? panel.pinStart : panel.pinEnd}
			onClick={() => setPin(id, !pinned)}
		/>
	);
	return (
		<section
			id={id}
			aria-label={label}
			data-open={open ? "open" : "closed"}
			data-pinned={pinned ? "pinned" : "loose"}
			className={clsx(
				panel.shell,
				edge === "bottom" && panel.up,
				open && panel.shellOpen,
				layout,
			)}
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
			<Button
				icon={icon}
				label={label}
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => setPin(id, !pinned)}
			/>
			<div className={clsx(panel.reveal, open && panel.revealOpen)}>
				<div className={clsx(panel.clip)}>
					<div id={bodyId} inert={!open} className={clsx(panel.body)}>
						{edge === "bottom" ? pin : null}
						{children}
						{edge === "top" ? pin : null}
					</div>
				</div>
			</div>
		</section>
	);
}

export function Legend() {
	const states = useQuery(pageQuery.settings).data?.states ?? [];
	return (
		<FloatPanel
			id="graph-legend"
			label={floatPanelLabel.legend}
			icon="map"
			edge="top"
			layout={panel.legend}
		>
			<section
				aria-label={projectGraphLabel.legend}
				className={clsx(panel.legendList)}
			>
				<ul className={clsx(board.legendRow)}>
					{states.map((state) => (
						<li key={state.id} className={clsx(board.legendItem)}>
							<span
								{...tonedProps(state.colour, undefined, board.legendDot)}
								data-state={state.id}
							/>
							{state.label}
						</li>
					))}
				</ul>
				<p className={clsx(board.legendNote, board.legendEdge)}>
					<span className={clsx(board.legendSwatch)} />
					{projectGraphLabel.arrow}
				</p>
				<p className={clsx(board.legendNote, board.legendEdge)}>
					<span className={clsx(board.legendSwatch, board.legendSwatchDone)} />
					{projectGraphLabel.done}
				</p>
				<p className={clsx(board.legendNote)}>{projectGraphLabel.dashed}</p>
			</section>
		</FloatPanel>
	);
}
