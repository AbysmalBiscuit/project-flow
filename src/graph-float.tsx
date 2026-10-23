import * as stylex from "@stylexjs/stylex";
import type { FitViewOptions } from "@xyflow/react";
import { board } from "./board-styles.ts";
import type { TicketState } from "./domain.ts";
import { projectGraphLabel, stateLabel } from "./terms.ts";
import { measure, space, stack } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

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

const stateTone: Record<TicketState, { label: string }> = {
	backlog: { label: stateLabel.backlog },
	inProgress: { label: stateLabel.inProgress },
	inReview: { label: stateLabel.inReview },
	awaitingMerge: { label: stateLabel.awaitingMerge },
	done: { label: stateLabel.done },
	dropped: { label: stateLabel.dropped },
};

const legendTone: Record<TicketState, (typeof board)["legendDone"]> = {
	backlog: board.legendReady,
	inProgress: board.legendProgress,
	inReview: board.legendReview,
	awaitingMerge: board.legendMerge,
	done: board.legendDone,
	dropped: board.legendDropped,
};

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
						<span className={clsx(board.legendDot, legendTone[state])} />
						{stateTone[state].label}
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
