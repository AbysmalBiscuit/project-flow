import * as stylex from "@stylexjs/stylex";
import { type FitViewOptions, useStore } from "@xyflow/react";
import { useEffect, useState } from "react";
import { board } from "./board-styles.ts";
import type { TicketState } from "./domain.ts";
import { stateTones } from "./state-tone.ts";
import { projectGraphLabel, stateLabel } from "./terms.ts";
import { measure, space, stack } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { cards } from "./ui-styles.ts";

export const fitPadding = 0.28;

/**
 * Fits the project graph below the legend. The top padding is the legend
 * height plus the fit padding, so no card or frame lies under the legend.
 */
export function legendFit(): FitViewOptions {
	const pane = document.getElementById("project-graph-pane");
	const legend = pane?.querySelector(
		`[aria-label="${projectGraphLabel.legend}"]`,
	);
	if (pane == null || legend == null) {
		return { padding: fitPadding, maxZoom: 1 };
	}
	const box = pane.getBoundingClientRect();
	const margin = (box.height - box.height / (1 + fitPadding)) / 2;
	const top = legend.getBoundingClientRect().bottom - box.top + margin;
	return {
		padding: { top: `${top}px`, x: fitPadding, bottom: fitPadding },
		maxZoom: 1,
	};
}

function boxesApart(one: DOMRect, other: DOMRect): boolean {
	return (
		Math.round(one.right) <= Math.round(other.left) ||
		Math.round(other.right) <= Math.round(one.left) ||
		Math.round(one.bottom) <= Math.round(other.top) ||
		Math.round(other.bottom) <= Math.round(one.top)
	);
}

function legendClear(): boolean | null {
	const pane = document.getElementById("project-graph-pane");
	const legend = pane?.querySelector(
		`[aria-label="${projectGraphLabel.legend}"]`,
	);
	if (pane == null || legend == null) {
		return null;
	}
	const legendBox = legend.getBoundingClientRect();
	return [...pane.querySelectorAll(".react-flow__node")].every((node) =>
		boxesApart(legendBox, node.getBoundingClientRect()),
	);
}

/** Reports whether the legend covers a card or a frame in the current view. */
export function LegendProbe() {
	const transform = useStore((state) => state.transform);
	const nodes = useStore((state) => state.nodes);
	const [clear, setClear] = useState<boolean | null>(null);
	useEffect(() => {
		void transform;
		void nodes;
		const frame = requestAnimationFrame(() => setClear(legendClear()));
		return () => cancelAnimationFrame(frame);
	}, [transform, nodes]);
	return (
		<p id="project-graph-legend" className={clsx(cards.graphProbe)}>
			{clear === null ? "" : clear ? "legend-clear" : "legend-covers"}
		</p>
	);
}

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
		alignItems: "flex-start",
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
		pointerEvents: "auto",
	},
	legend: {
		minWidth: "min-content",
		maxWidth: measure.legendCap,
		pointerEvents: "none",
	},
});

const legendOrder = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
	"dropped",
] as const satisfies ReadonlyArray<TicketState>;

export function Legend() {
	return (
		<section
			className={clsx(board.legendBox, float.legend)}
			aria-label={projectGraphLabel.legend}
		>
			<ul className={clsx(board.legendRow)}>
				{legendOrder.map((state) => (
					<li key={state} className={clsx(board.legendItem)}>
						<span className={clsx(board.legendDot, stateTones[state])} />
						{stateLabel[state]}
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
	);
}
