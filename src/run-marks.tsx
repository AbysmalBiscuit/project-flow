import { board, runDotTone } from "./board-styles.ts";
import type { ShownFactoryRun } from "./domain.ts";
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

export function StageChip({ stage }: { stage: string }) {
	return (
		<span className={clsx(board.chip, board.chipStatic, board.chipStage)}>
			{stage}
		</span>
	);
}
