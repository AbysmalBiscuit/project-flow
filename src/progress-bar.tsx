import * as stylex from "@stylexjs/stylex";
import type { ProjectCounts } from "./domain.ts";
import { stateTones } from "./state-tone.ts";
import { clsx } from "./ui.ts";
import { cards } from "./ui-styles.ts";

export function ticketTotal(project: ProjectCounts): number {
	return (
		project.done +
		project.dropped +
		project.backlog +
		project.inProgress +
		project.inReview +
		project.awaitingMerge
	);
}

export function trackerName(tracker: ProjectCounts["tracker"]): string {
	return tracker === "linear" ? "Linear" : "GitHub";
}

export const barSegments = [
	{ key: "done", tone: stateTones.done },
	{ key: "inProgress", tone: stateTones.inProgress },
	{ key: "inReview", tone: stateTones.inReview },
	{ key: "awaitingMerge", tone: stateTones.awaitingMerge },
	{ key: "backlog", tone: stateTones.backlog },
] as const;

export function SegmentedBar({ project }: { project: ProjectCounts }) {
	const total = ticketTotal(project);
	if (total === 0) {
		return null;
	}
	return (
		<div
			className={clsx(cards.bar)}
			role="progressbar"
			aria-valuenow={project.progress}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label={`${project.name} progress`}
		>
			{barSegments.map((item) =>
				project.statusTypes[item.key] === 0 ? null : (
					<div
						key={item.key}
						{...stylex.props(
							cards.segment(
								`${(project.statusTypes[item.key] / total) * 100}%`,
							),
							item.tone,
						)}
					/>
				),
			)}
		</div>
	);
}
