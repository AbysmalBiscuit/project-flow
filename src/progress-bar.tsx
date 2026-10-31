import * as stylex from "@stylexjs/stylex";

import type { ProjectCounts } from "./domain.ts";
import { stateTones } from "./state-tone.ts";
import { cards } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

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

const barSegments = [
	{ key: "done", tone: stateTones.done },
	{ key: "inProgress", tone: stateTones.inProgress },
	{ key: "inReview", tone: stateTones.inReview },
	{ key: "awaitingMerge", tone: stateTones.awaitingMerge },
	{ key: "backlog", tone: stateTones.backlog },
] as const;

const barTrack = { card: cards.bar, cell: cards.barThin } as const;

/** A project's state segments. A card hides the bar of an empty project; a table cell keeps the empty track. */
export function SegmentedBar({
	project,
	variant = "card",
}: {
	project: ProjectCounts;
	variant?: keyof typeof barTrack;
}) {
	const total = ticketTotal(project);
	if (total === 0 && variant === "card") {
		return null;
	}
	return (
		<div
			className={clsx(barTrack[variant])}
			role="progressbar"
			aria-valuenow={project.progress}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label={`${project.name} progress`}
		>
			{barSegments.map((item) =>
				project.statusTypes[item.key] === 0 || total === 0 ? null : (
					<div
						key={item.key}
						data-state={item.key}
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
