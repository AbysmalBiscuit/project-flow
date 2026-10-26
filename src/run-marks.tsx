import { board, runDotTone } from "./board-styles.ts";
import type { ShownFactoryRun } from "./domain.ts";
import { openPage, runPagePath } from "./page-links.ts";
import { spanLabel } from "./poll-age.ts";
import { factoryRunTip } from "./terms.ts";
import { clsx } from "./ui.ts";

/** The circle that shows the factory feed covers a card's run, coloured by its status. */
export function RunDot({ run }: { run: ShownFactoryRun }) {
	const started =
		run.startedAt === null ? Number.NaN : Date.parse(run.startedAt);
	const ended = run.endedAt === null ? Date.now() : Date.parse(run.endedAt);
	const tip = factoryRunTip(
		run,
		Number.isNaN(started) ? null : spanLabel(started, ended),
	);
	return (
		<span
			role="img"
			aria-label={tip}
			title={tip}
			data-run-status={run.statusKind}
			className={clsx(board.runDot, runDotTone[run.statusKind])}
		/>
	);
}

/**
 * The run dot of a ticket card as a link to the run page. The link sits
 * inside the card button, so it keeps its clicks from the card.
 */
export function RunLink({ run }: { run: ShownFactoryRun }) {
	const href = runPagePath(run.id);
	return (
		<a
			href={href}
			data-run-link={run.id}
			className={clsx(board.runLink, board.cardFocus)}
			onClick={(event) => {
				event.stopPropagation();
				if (
					event.button !== 0 ||
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey ||
					event.altKey
				) {
					return;
				}
				event.preventDefault();
				openPage(href);
			}}
			onDoubleClick={(event) => event.stopPropagation()}
		>
			<RunDot run={run} />
		</a>
	);
}

export function StageChip({ stage }: { stage: string }) {
	return (
		<span className={clsx(board.chip, board.chipStatic, board.chipStage)}>
			{stage}
		</span>
	);
}
