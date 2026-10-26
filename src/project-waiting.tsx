import { board } from "./board-styles.ts";
import type { ProjectCounts } from "./domain.ts";
import { PollLoading } from "./loading.tsx";
import { SegmentedBar, ticketTotal } from "./progress-bar.tsx";
import { PageFrame } from "./shell.tsx";
import { overviewControlLabel } from "./terms.ts";
import { shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

function waitingCountLine(project: ProjectCounts): string {
	const needsYou =
		project.needsYou === 1
			? overviewControlLabel.needsYouOne
			: `${project.needsYou} ${overviewControlLabel.needsYouMany}`;
	return `${project.done} of ${ticketTotal(project)} done, ${needsYou}, ${project.blocked} blocked.`;
}

/** The project page before its report arrives, from the overview cache. */
export function ProjectWaiting({
	name,
	counts,
	error,
}: {
	name: string;
	counts: ProjectCounts | undefined;
	error: string | null;
}) {
	return (
		<PageFrame title={counts?.name ?? name}>
			{counts === undefined || counts.pending === true ? null : (
				<>
					<p id="project-waiting-counts" className={clsx(board.counts)}>
						{waitingCountLine(counts)}
					</p>
					<SegmentedBar project={counts} />
				</>
			)}
			{error === null ? (
				<div id="poll-progress">
					<PollLoading />
				</div>
			) : (
				<p id="project-error" className={clsx(shell.stale)}>
					{error}
				</p>
			)}
		</PageFrame>
	);
}
