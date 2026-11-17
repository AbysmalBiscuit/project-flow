import { clsx } from "./ui.ts";
import type { VerificationPage } from "./verification-page.ts";
import { styles } from "./verification-styles.ts";
import { verificationCopy } from "./workflows-terms.ts";

function Tile({
	label,
	value,
	detail,
	warn = false,
}: {
	label: string;
	value: string;
	detail: string;
	warn?: boolean;
}) {
	return (
		<div className={clsx(styles.card)}>
			<div className={clsx(styles.kicker)}>{label}</div>
			<div className={clsx(styles.tileValue, warn && styles.tileWarn)}>
				{value}
			</div>
			<div className={clsx(styles.tileDetail)}>{detail}</div>
		</div>
	);
}

export function Tiles({ tiles }: { tiles: VerificationPage["tiles"] }) {
	const { firstRound, rejected, failLines, ci } = tiles;
	return (
		<div className={clsx(styles.grid, styles.tiles)}>
			<Tile
				label={verificationCopy.tiles.firstRound}
				value={verificationCopy.percent(firstRound.verified, firstRound.items)}
				detail={verificationCopy.firstRoundDetail(firstRound.items)}
			/>
			<Tile
				label={verificationCopy.tiles.rejected}
				value={String(rejected.items)}
				detail={verificationCopy.mostOften(rejected.topReason)}
				warn={rejected.items > 0}
			/>
			<Tile
				label={verificationCopy.tiles.failLines}
				value={verificationCopy.perRun(failLines.lines, failLines.runs)}
				detail={verificationCopy.highSeverity(
					verificationCopy.perRun(failLines.high, failLines.runs),
				)}
			/>
			<Tile
				label={verificationCopy.tiles.ci}
				value={verificationCopy.percent(ci.passed, ci.runs)}
				detail={verificationCopy.firstPush(
					verificationCopy.percent(ci.firstPush, ci.runs),
				)}
			/>
		</div>
	);
}
