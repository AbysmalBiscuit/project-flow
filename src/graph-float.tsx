import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import { board } from "./board-styles.ts";
import { pageQuery } from "./queries.ts";
import { tonedProps } from "./state-tone.ts";
import { projectGraphLabel } from "./terms.ts";
import { measure, space, stack } from "./tokens.stylex.ts";
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
		pointerEvents: "auto",
	},
	legend: {
		minWidth: "min-content",
		maxWidth: measure.legendCap,
		pointerEvents: "none",
	},
});

export function Legend() {
	const states = useQuery(pageQuery.settings).data?.states ?? [];
	return (
		<section
			className={clsx(board.legendBox, float.legend)}
			aria-label={projectGraphLabel.legend}
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
	);
}
