import * as stylex from "@stylexjs/stylex";

import { pollLine, pollPercent, usePollProgress } from "./poll-freshness.tsx";
import { loadingLabel } from "./terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { frame } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
	row: {
		display: "flex",
		gap: space.sm,
		alignItems: "center",
		margin: `0 0 ${space.md}`,
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	inline: {
		display: "inline-flex",
		margin: 0,
		verticalAlign: "middle",
	},
	spinner: {
		display: "inline-block",
		flexShrink: 0,
		boxSizing: "border-box",
		width: measure.glyph,
		height: measure.glyph,
		borderWidth: measure.focus,
		borderStyle: "solid",
		borderColor: colours.line,
		borderTopColor: colours.accent,
		borderRadius: radius.pill,
		animationName: {
			default: stylex.keyframes({
				from: { transform: "rotate(0deg)" },
				to: { transform: "rotate(360deg)" },
			}),
			[reducedMotion]: "none",
		},
		animationDuration: measure.spin,
		animationTimingFunction: "linear",
		animationIterationCount: "infinite",
	},
	track: {
		display: "flex",
		flexShrink: 0,
		width: measure.loadBar,
		height: space.xs,
		borderRadius: radius.pill,
		backgroundColor: colours.segment,
		overflow: "hidden",
	},
	fill: (width: string) => ({
		width,
		height: "100%",
		backgroundColor: colours.accent,
		transitionProperty: { default: "width", [reducedMotion]: "none" },
		transitionDuration: measure.move,
	}),
});

/** A spinner for a loading state with no known progress. Screen readers read the label. */
export function Loading({
	label = loadingLabel,
	inline = false,
}: {
	label?: string;
	inline?: boolean;
}) {
	return (
		<span
			role="status"
			data-loading="spinner"
			className={clsx(styles.row, inline && styles.inline)}
		>
			<span aria-hidden="true" className={clsx(styles.spinner)} />
			<span className={clsx(frame.visuallyHidden)}>{label}</span>
		</span>
	);
}

/** A progress bar for a loading state with known progress, and the line that says what it reads. */
export function LoadingBar({
	percent,
	text,
}: {
	percent: number;
	text: string;
}) {
	return (
		<div data-loading="bar" className={clsx(styles.row)}>
			<div
				role="progressbar"
				aria-label={loadingLabel}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				aria-valuetext={text}
				className={clsx(styles.track)}
			>
				<div {...stylex.props(styles.fill(`${percent}%`))} />
			</div>
			<span>{text}</span>
		</div>
	);
}

/** The bar of the running poll, or a spinner before the poll reports progress. */
export function PollLoading() {
	const progress = usePollProgress();
	if (progress === null) {
		return <Loading />;
	}
	return (
		<LoadingBar percent={pollPercent(progress)} text={pollLine(progress)} />
	);
}
