import { board } from "./board-styles.ts";
import type { ProjectCounts } from "./domain.ts";
import { pollLine, usePollProgress } from "./poll-freshness.tsx";
import { SegmentedBar, ticketTotal } from "./progress-bar.tsx";
import { PageFrame } from "./shell.tsx";
import { loadingLabel, overviewControlLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards, shell } from "./ui-styles.ts";

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
	const progress = usePollProgress();
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
				<p id="poll-progress" className={clsx(cards.loading)}>
					{progress === null ? loadingLabel : pollLine(progress)}
				</p>
			) : (
				<p id="project-error" className={clsx(shell.stale)}>
					{error}
				</p>
			)}
		</PageFrame>
	);
}
