import * as stylex from "@stylexjs/stylex";
import { Fragment } from "react";
import { Segment } from "./segment.tsx";
import { frameToolLabel, graphScopeLabel, openFramesLabel } from "./terms.ts";
import { colours, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { headerControlStyle as tools } from "./ui-styles.ts";

const scope = stylex.create({
	place: {
		flex: "0 1 auto",
		alignSelf: "flex-start",
		minWidth: 0,
		maxWidth: "100%",
		marginLeft: "auto",
		overflow: "hidden",
		pointerEvents: "auto",
	},
	mark: {
		color: colours.inkSoft,
		fontSize: type.menu,
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
			className={clsx(tools.group, scope.place)}
		>
			{parts.map((part, index) => (
				<Fragment key={part.scope}>
					{index === 0 ? null : (
						<span aria-hidden="true" className={clsx(scope.mark)}>
							/
						</span>
					)}
					<Segment
						label={part.label}
						data-scope={part.scope}
						aria-current={index === parts.length - 1 ? "location" : undefined}
						onClick={part.onClick}
					/>
				</Fragment>
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
