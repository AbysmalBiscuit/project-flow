import { Segment } from "./segment.tsx";
import { frameToolLabel } from "./terms.ts";
import { headerControlStyle as tools } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

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
