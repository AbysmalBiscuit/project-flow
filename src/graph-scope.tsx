import * as stylex from "@stylexjs/stylex";
import { board } from "./board-styles.ts";
import { Segment } from "./segment.tsx";
import { frameToolLabel, graphScopeLabel, openFramesLabel } from "./terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { headerControlStyle as tools } from "./ui-styles.ts";

const scope = stylex.create({
	line: {
		flex: "0 1 auto",
		alignSelf: "flex-start",
		display: "flex",
		flexWrap: "wrap",
		alignItems: "baseline",
		gap: space.xs,
		justifyContent: "flex-end",
		minWidth: 0,
		marginLeft: "auto",
		padding: `${space.xs} ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.sm,
		backgroundColor: colours.raised,
		color: colours.inkSoft,
		fontSize: type.meta,
		pointerEvents: "auto",
	},
	part: {
		display: "inline-flex",
		alignItems: "baseline",
		gap: space.xs,
		minWidth: 0,
	},
	mark: {
		color: colours.inkSoft,
	},
	link: {
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: colours.inkSoft,
		font: "inherit",
		textAlign: "start",
		textDecorationLine: "underline",
		textUnderlineOffset: space.twoXs,
		cursor: "pointer",
	},
});

/** Names what the graph shows. Each part returns the graph to that scope. */
export function ScopeLine({
	project,
	openFrames,
	focus,
	onProject,
	onFrames,
	onFocus,
}: {
	project: string;
	openFrames: number;
	focus: readonly string[];
	onProject: () => void;
	onFrames: () => void;
	onFocus: () => void;
}) {
	const parts = [
		{ scope: "project", label: project, onClick: onProject },
		{ scope: "frames", label: openFramesLabel(openFrames), onClick: onFrames },
		...(focus.length === 0
			? []
			: [
					{
						scope: "focus",
						label: `${graphScopeLabel.focus}: ${focus.join(", ")}`,
						onClick: onFocus,
					},
				]),
	];
	return (
		<nav
			id="project-graph-scope"
			aria-label={graphScopeLabel.nav}
			className={clsx(scope.line)}
		>
			{parts.map((part, index) => (
				<span key={part.scope} className={clsx(scope.part)}>
					{index === 0 ? null : (
						<span aria-hidden="true" className={clsx(scope.mark)}>
							/
						</span>
					)}
					<button
						type="button"
						className={clsx(scope.link, board.cardFocus)}
						data-scope={part.scope}
						aria-current={index === parts.length - 1 ? "location" : undefined}
						onClick={part.onClick}
					>
						{part.label}
					</button>
				</span>
			))}
		</nav>
	);
}

export function FrameTools({
	parents,
	onAll,
}: {
	parents: number;
	onAll: (collapsed: boolean) => void;
}) {
	return (
		<div className={clsx(tools.graphTools)}>
			<Segment
				id="project-graph-expand-all"
				label={frameToolLabel.expandAll}
				disabled={parents === 0}
				onClick={() => onAll(false)}
			/>
			<Segment
				id="project-graph-collapse-all"
				label={frameToolLabel.collapseAll}
				disabled={parents === 0}
				onClick={() => onAll(true)}
			/>
		</div>
	);
}
