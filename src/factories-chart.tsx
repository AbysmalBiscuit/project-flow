import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { Button } from "./button.tsx";
import type { DayOutcome, StageDuration } from "./factories-page.ts";
import { styles } from "./factories-parts.tsx";
import { factoriesCopy, spanText } from "./factories-terms.ts";
import type { RangeDays } from "./factories-view.ts";
import { costLabel } from "./run-terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const chartStyles = stylex.create({
	chart: {
		display: "flex",
		gap: measure.outcomeGap,
		alignItems: "flex-end",
		position: "absolute",
		inset: 0,
	},
	chartCrowded: {
		gap: measure.hairline,
	},
	plotFrame: {
		display: "flex",
		gap: space.sm,
		marginTop: space.sm,
	},
	yAxis: {
		position: "relative",
		flexShrink: 0,
		width: measure.chartAxis,
		height: measure.outcomeChart,
		color: colours.inkSoft,
		fontSize: type.tag,
	},
	yTick: (from: string) => ({
		position: "absolute",
		right: 0,
		bottom: from,
		transform: "translateY(50%)",
		lineHeight: 1,
	}),
	plot: {
		position: "relative",
		flexGrow: 1,
		height: measure.outcomeChart,
	},
	gridLine: (from: string) => ({
		position: "absolute",
		left: 0,
		right: 0,
		bottom: from,
		borderTopWidth: measure.hairline,
		borderTopStyle: "dashed",
		borderTopColor: colours.line,
	}),
	day: {
		display: "flex",
		flex: 1,
		flexDirection: "column-reverse",
		minWidth: 0,
		height: "100%",
		padding: 0,
		borderWidth: 0,
		borderRadius: radius.cell,
		backgroundColor: "transparent",
		outline: "none",
		cursor: "default",
		transitionProperty: {
			default: "opacity, background-color",
			[reducedMotion]: "none",
		},
		transitionDuration: measure.fade,
	},
	dayDim: {
		opacity: 0.45,
	},
	dayHover: {
		backgroundColor: colours.surfaceMuted,
	},
	dayStack: (share: string) => ({
		display: "flex",
		flexDirection: "column-reverse",
		width: "100%",
		height: share,
		borderRadius: radius.cell,
		outlineWidth: measure.focus,
		outlineStyle: "solid",
		outlineColor: "transparent",
		outlineOffset: measure.hairline,
		transitionProperty: { default: "outline-color", [reducedMotion]: "none" },
		transitionDuration: measure.fade,
	}),
	dayStackHover: {
		outlineColor: colours.ink,
	},
	segment: (share: string) => ({
		height: share,
	}),
	tip: (at: string) => ({
		position: "absolute",
		top: 0,
		left: at,
		zIndex: 1,
		minWidth: measure.chartTip,
		padding: space.sm,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.line,
		borderRadius: radius.menu,
		backgroundColor: colours.raised,
		boxShadow: `0 ${space.xs} ${space.md} ${colours.shadow}`,
		fontSize: type.meta,
		pointerEvents: "none",
	}),
	// The card sits beside the hovered bar, on the side with more room.
	tipRight: { transform: `translateX(${space.sm})` },
	tipLeft: { transform: `translateX(calc(-100% - ${space.sm}))` },
	tipHead: {
		display: "flex",
		justifyContent: "space-between",
		gap: space.md,
		marginBottom: space.xs,
		fontWeight: type.weight,
	},
	tipTotal: {
		color: colours.inkSoft,
		fontWeight: type.regular,
	},
	tipRow: {
		display: "flex",
		justifyContent: "space-between",
		gap: space.md,
		color: colours.inkSoft,
	},
	tipCount: {
		color: colours.ink,
		fontVariantNumeric: "tabular-nums",
	},
	xTick: {
		display: "flex",
		flex: "1 1 0",
		justifyContent: "center",
		minWidth: 0,
		whiteSpace: "nowrap",
	},
	axis: {
		display: "flex",
		gap: measure.outcomeGap,
		marginTop: space.twoXs,
		marginLeft: `calc(${measure.chartAxis} + ${space.sm})`,
		color: colours.inkSoft,
		fontSize: type.tag,
	},
	more: {
		marginTop: space.md,
	},
	spreadColumn: {
		width: measure.spreadColumn,
	},
	spread: {
		display: "flex",
		height: measure.meterBar,
		overflow: "hidden",
		borderRadius: radius.pill,
	},
	spreadP50: (share: string) => ({
		width: share,
		backgroundColor: colours.accent,
	}),
	spreadP95: (share: string) => ({
		width: share,
		backgroundColor: colours.chip,
	}),
});

const outcomeKinds = ["merged", "failed", "stopped"] as const;

const dayLabel = (day: string) =>
	new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

/** The most x axis labels under the outcome chart. */
const dayLabelsShown = 7;

/** The y axis ticks from 0 to a round top at or above `most`, about four steps apart. */
function runTicks(most: number): number[] {
	const rough = Math.max(1, most) / 4;
	const scale = 10 ** Math.floor(Math.log10(rough));
	const step = Math.max(
		1,
		([1, 2, 5, 10].find((factor) => factor * scale >= rough) ?? 10) * scale,
	);
	const top = Math.max(step, Math.ceil(most / step) * step);
	return Array.from({ length: top / step + 1 }, (_, index) => index * step);
}

export const total = (day: DayOutcome) => day.merged + day.failed + day.stopped;

export function OutcomeChart({ days }: { days: DayOutcome[] }) {
	const [hovered, setHovered] = useState<number | null>(null);
	const ticks = runTicks(Math.max(0, ...days.map(total)));
	const top = ticks.at(-1) ?? 1;
	const labelEvery = Math.ceil(days.length / dayLabelsShown);
	const last = days.length - 1;
	const shown = hovered === null ? undefined : days[hovered];
	const crowded = days.length > 30;
	return (
		<>
			<div className={clsx(chartStyles.plotFrame)}>
				<div className={clsx(chartStyles.yAxis)} aria-hidden="true">
					{ticks.map((tick) => (
						<span
							key={tick}
							{...stylex.props(chartStyles.yTick(`${(tick / top) * 100}%`))}
						>
							{tick}
						</span>
					))}
				</div>
				<div className={clsx(chartStyles.plot)}>
					{ticks.map((tick) => (
						<span
							key={tick}
							aria-hidden="true"
							{...stylex.props(chartStyles.gridLine(`${(tick / top) * 100}%`))}
						/>
					))}
					<div
						className={clsx(
							chartStyles.chart,
							crowded && chartStyles.chartCrowded,
						)}
					>
						{days.map((day, index) => (
							<button
								key={day.day}
								type="button"
								aria-label={factoriesCopy.dayOutcome(dayLabel(day.day), day)}
								className={clsx(
									chartStyles.day,
									hovered !== null && hovered !== index && chartStyles.dayDim,
									hovered === index && chartStyles.dayHover,
								)}
								onMouseEnter={() => setHovered(index)}
								onMouseLeave={() => setHovered(null)}
								onFocus={() => setHovered(index)}
								onBlur={() => setHovered(null)}
							>
								<span
									{...stylex.props(
										chartStyles.dayStack(`${(total(day) / top) * 100}%`),
										hovered === index &&
											total(day) > 0 &&
											chartStyles.dayStackHover,
									)}
								>
									{outcomeKinds.map((kind) => (
										<span
											key={kind}
											{...stylex.props(
												chartStyles.segment(
													`${total(day) === 0 ? 0 : (day[kind] / total(day)) * 100}%`,
												),
												styles[kind],
											)}
										/>
									))}
								</span>
							</button>
						))}
					</div>
					{shown === undefined || hovered === null ? null : (
						<div
							role="tooltip"
							{...stylex.props(
								...(hovered < days.length / 2
									? [
											chartStyles.tip(
												`${((hovered + 1) / days.length) * 100}%`,
											),
											chartStyles.tipRight,
										]
									: [
											chartStyles.tip(`${(hovered / days.length) * 100}%`),
											chartStyles.tipLeft,
										]),
							)}
						>
							<div className={clsx(chartStyles.tipHead)}>
								<span>
									{hovered === last ? factoriesCopy.today : dayLabel(shown.day)}
								</span>
								<span className={clsx(chartStyles.tipTotal)}>
									{total(shown)} {factoriesCopy.runsAxis}
								</span>
							</div>
							{outcomeKinds.map((kind) => (
								<div key={kind} className={clsx(chartStyles.tipRow)}>
									<span className={clsx(styles.legendItem)}>
										<span className={clsx(styles.swatch, styles[kind])} />
										{factoriesCopy.outcome[kind]}
									</span>
									<span className={clsx(chartStyles.tipCount)}>
										{shown[kind]}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
			<div
				className={clsx(chartStyles.axis, crowded && chartStyles.chartCrowded)}
			>
				{days.map((day, index) => (
					<span key={day.day} className={clsx(chartStyles.xTick)}>
						{(last - index) % labelEvery !== 0
							? null
							: index === last
								? factoriesCopy.today
								: dayLabel(day.day)}
					</span>
				))}
			</div>
			<div className={clsx(styles.legend)}>
				{outcomeKinds.map((kind) => (
					<span key={kind} className={clsx(styles.legendItem)}>
						<span className={clsx(styles.swatch, styles[kind])} />
						{factoriesCopy.outcome[kind]}
					</span>
				))}
			</div>
		</>
	);
}

const secondsText = (seconds: number) => spanText(seconds * 1_000);

/** The stages that the table shows until Lev asks for all of them. */
const shortStageList = 10;

export function StageTable({
	stages,
	days,
}: {
	stages: StageDuration[];
	days: RangeDays;
}) {
	const [all, setAll] = useState(false);
	if (stages.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noStages(days)}</p>;
	}
	const shown = all ? stages : stages.slice(0, shortStageList);
	const { columns } = factoriesCopy;
	const slowest = Math.max(...stages.map((stage) => stage.p95S));
	const share = (seconds: number) =>
		`${slowest === 0 ? 0 : (seconds / slowest) * 100}%`;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.stageName}</th>
						<th className={clsx(styles.th)}>{columns.role}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.runs}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.p50}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.p95}</th>
						<th
							className={clsx(styles.th, chartStyles.spreadColumn, styles.wide)}
						>
							{columns.spread}
						</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.retries}
						</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.costPerRun}
						</th>
					</tr>
				</thead>
				<tbody>
					{shown.map((stage, index) => {
						const last = index === shown.length - 1;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr key={stage.stage} className={clsx(styles.row)}>
								<td className={cell(styles.nowrap)}>{stage.stage}</td>
								<td className={cell()}>
									<span className={clsx(styles.pill)}>
										{factoriesCopy.stageRole[stage.role]}
									</span>
								</td>
								<td className={cell(styles.number)}>{stage.runs}</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{secondsText(stage.p50S)}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{secondsText(stage.p95S)}
								</td>
								<td className={cell(styles.wide)}>
									<span className={clsx(chartStyles.spread)}>
										<span
											{...stylex.props(
												chartStyles.spreadP50(share(stage.p50S)),
											)}
										/>
										<span
											{...stylex.props(
												chartStyles.spreadP95(share(stage.p95S - stage.p50S)),
											)}
										/>
									</span>
								</td>
								<td className={cell(styles.number)}>
									{Number(stage.retriesPerRun.toFixed(1))}
								</td>
								<td className={cell(styles.number)}>
									{stage.costPerRun === null
										? factoriesCopy.noCost
										: costLabel(stage.costPerRun)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{stages.length > shortStageList ? (
				<div className={clsx(chartStyles.more)}>
					<Button
						label={
							all
								? factoriesCopy.fewerStages
								: factoriesCopy.allStages(stages.length)
						}
						onClick={() => setAll(!all)}
					/>
				</div>
			) : null}
		</div>
	);
}
