import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "./button.tsx";
import { textControl } from "./control-styles.ts";
import { Dropdown } from "./dropdown.tsx";
import type {
	AttentionItem,
	DayOutcome,
	FactoriesPage,
	FactoryCard,
	NotServedPanel,
	QueueItem,
	RunningRun,
	StageDuration,
} from "./factories-page.ts";
import {
	factoryCheckMs,
	outcomeDays,
	type RangeDays,
	rangeDays,
	stageDays,
} from "./factories-page.ts";
import type { HostDisk, HostHealth, HostLevel } from "./host-health.ts";
import { PageLoading } from "./loading.tsx";
import { runPagePath } from "./page-links.ts";
import { pageQuery } from "./queries.ts";
import type { RunGraph, RunGraphNodeState } from "./run-domain.ts";
import { PageFrame } from "./shell.tsx";
import {
	costLabel,
	factoriesCopy,
	navLabel,
	roughSpanText,
	spanText,
} from "./terms.ts";
import { ticketLabel } from "./ticket-key.ts";
import {
	colours,
	font,
	measure,
	media,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { useNow } from "./use-now.ts";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const beat = stylex.keyframes({
	"0%": { transform: "scale(1)" },
	"30%": { transform: "scale(1.8)" },
	"100%": { transform: "scale(1)" },
});

const styles = stylex.create({
	grid: {
		display: "grid",
		gap: space.lg,
		marginBottom: space.lg,
	},
	tiles: {
		gridTemplateColumns: `repeat(auto-fit, minmax(${measure.tileMin}, 1fr))`,
	},
	boxes: {
		gridTemplateColumns: {
			default: `repeat(auto-fill, minmax(${measure.boxCardMin}, 1fr))`,
			[media.projectBar]: "minmax(0, 1fr)",
		},
	},
	band: {
		marginBottom: space.lg,
		padding: space.md,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.groupFill,
	},
	bandHead: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		marginBottom: space.md,
	},
	bandGrid: {
		marginBottom: 0,
	},
	two: {
		gridTemplateColumns: {
			default: "minmax(0, 2fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
		alignItems: "start",
	},
	card: {
		boxSizing: "border-box",
		minWidth: 0,
		padding: space.lg,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
	},
	stretch: {
		alignSelf: "stretch",
	},
	kicker: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	tileValue: {
		color: colours.ink,
		fontSize: type.tileValue,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
	},
	tileWarn: {
		color: colours.warn,
	},
	tileBad: {
		color: colours.danger,
	},
	tileDetail: {
		display: "-webkit-box",
		overflow: "hidden",
		color: colours.inkSoft,
		fontSize: type.meta,
		overflowWrap: "anywhere",
		WebkitBoxOrient: "vertical",
		WebkitLineClamp: 2,
	},
	box: {
		borderLeftWidth: measure.boxEdge,
		borderLeftColor: colours.awaitingMerge,
	},
	boxWarn: {
		borderLeftColor: colours.warn,
	},
	boxBad: {
		borderLeftColor: colours.danger,
	},
	boxOff: {
		borderLeftColor: colours.inkSoft,
		opacity: 0.6,
	},
	keptHeight: (height: string) => ({ minHeight: height }),
	head: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		marginBottom: space.md,
	},
	heading: {
		margin: 0,
		color: colours.ink,
		fontSize: type.heading,
		fontWeight: type.weight,
	},
	meta: {
		display: "inline-flex",
		gap: space.sm,
		alignItems: "center",
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	beat: {
		width: measure.dot,
		height: measure.dot,
		borderRadius: radius.pill,
		backgroundColor: colours.inkSoft,
	},
	beatFresh: {
		backgroundColor: colours.awaitingMerge,
		animationName: { default: beat, [reducedMotion]: "none" },
		animationDuration: measure.beat,
		animationTimingFunction: "ease-out",
	},
	source: {
		marginLeft: "auto",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	sourceNeed: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	sourceAggregate: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	sourceNext: {
		marginLeft: 0,
	},
	sourceRow: {
		display: "flex",
		gap: space.xs,
		justifyContent: "flex-end",
		marginBottom: space.sm,
	},
	pill: {
		display: "inline-flex",
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	pillBad: {
		backgroundColor: colours.dangerWash,
		color: colours.danger,
	},
	pillInfo: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	pillWarn: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	pillOk: {
		backgroundColor: colours.okWash,
		color: colours.awaitingMerge,
	},
	stagePill: {
		marginLeft: space.xs,
	},
	meters: {
		display: "grid",
		gridTemplateColumns: `${measure.meterLabel} minmax(0, 1fr) max-content`,
		columnGap: space.sm,
	},
	meterSpan: {
		gridColumn: "1 / -1",
	},
	meter: {
		display: "grid",
		gridColumn: "1 / -1",
		gridTemplateColumns: "subgrid",
		alignItems: "center",
		margin: `${space.xs} 0`,
		color: colours.ink,
		fontSize: type.meter,
	},
	bar: {
		display: "flex",
		height: measure.meterBar,
		overflow: "hidden",
		borderRadius: radius.pill,
		backgroundColor: colours.meterTrack,
	},
	fill: (share: string) => ({
		width: share,
		height: "100%",
		backgroundColor: colours.accent,
	}),
	levelOk: {
		backgroundColor: colours.awaitingMerge,
	},
	levelWarn: {
		backgroundColor: colours.warn,
	},
	levelBad: {
		backgroundColor: colours.danger,
	},
	iowait: {
		backgroundColor: colours.done,
	},
	gated: {
		position: "relative",
	},
	gate: (left: string) => ({
		position: "absolute",
		top: 0,
		bottom: 0,
		left,
		width: measure.gateMark,
		backgroundColor: colours.ink,
	}),
	meterSmall: {
		color: colours.inkSoft,
		fontSize: type.meterSmall,
	},
	spark: {
		display: "block",
		width: "100%",
		maxWidth: measure.sparkWidth,
		height: measure.sparkHeight,
		overflow: "visible",
	},
	sparkLine: {
		fill: "none",
		stroke: colours.accent,
		strokeWidth: measure.sparkStroke,
	},
	mono: {
		overflow: "hidden",
		fontFamily: font.mono,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	worstWarn: {
		color: colours.warn,
	},
	worstBad: {
		color: colours.danger,
	},
	meterValue: {
		color: colours.inkMuted,
		textAlign: "right",
		whiteSpace: "nowrap",
		fontVariantNumeric: "tabular-nums",
	},
	note: {
		margin: `${space.sm} 0 0`,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	scroll: {
		overflowX: "auto",
	},
	table: {
		width: "100%",
		borderCollapse: "collapse",
		fontVariantNumeric: "tabular-nums",
	},
	th: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
		color: colours.inkSoft,
		fontSize: type.lane,
		fontWeight: type.weight,
		letterSpacing: type.headTrack,
		textAlign: "left",
		textTransform: "uppercase",
		whiteSpace: "nowrap",
	},
	row: {
		backgroundColor: {
			default: null,
			":hover": colours.surface,
		},
	},
	td: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
		verticalAlign: "middle",
	},
	lastRow: {
		borderBottomWidth: 0,
	},
	number: {
		textAlign: "right",
	},
	nowrap: {
		whiteSpace: "nowrap",
	},
	wrap: {
		overflowWrap: "anywhere",
	},
	wide: {
		display: {
			default: null,
			[media.projectBar]: "none",
		},
	},
	agent: {
		color: colours.inkMuted,
		fontSize: type.small,
	},
	clamp: {
		display: "-webkit-box",
		overflow: "hidden",
		overflowWrap: "anywhere",
		WebkitBoxOrient: "vertical",
		WebkitLineClamp: 2,
	},
	link: {
		color: colours.link,
		textDecoration: "none",
	},
	steps: {
		display: "flex",
		gap: measure.stepGap,
	},
	step: {
		flexShrink: 0,
		width: measure.step,
		height: measure.stepHeight,
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
	},
	stepDone: {
		backgroundColor: colours.awaitingMerge,
	},
	stepCurrent: {
		backgroundColor: colours.accent,
	},
	stepFailed: {
		backgroundColor: colours.danger,
	},
	stepStalled: {
		backgroundColor: colours.warn,
	},
	chart: {
		display: "flex",
		gap: measure.outcomeGap,
		alignItems: "flex-end",
		height: measure.outcomeChart,
	},
	day: {
		display: "flex",
		flex: 1,
		flexDirection: "column-reverse",
		height: "100%",
	},
	segment: (share: string) => ({
		height: share,
		borderRadius: measure.hairline,
	}),
	merged: {
		backgroundColor: colours.awaitingMerge,
	},
	failed: {
		backgroundColor: colours.danger,
	},
	stopped: {
		backgroundColor: colours.inkSoft,
	},
	axis: {
		display: "flex",
		justifyContent: "space-between",
		marginTop: space.twoXs,
		color: colours.inkSoft,
		fontSize: type.tag,
	},
	legend: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.md,
		marginTop: space.twoXs,
		color: colours.inkSoft,
		fontSize: type.lane,
	},
	swatch: {
		display: "inline-block",
		width: measure.legendSwatch,
		height: measure.legendSwatch,
		marginRight: space.twoXs,
		borderRadius: measure.hairline,
	},
	legendItem: {
		display: "inline-flex",
		alignItems: "center",
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
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	item: {
		display: "flex",
		gap: space.sm,
		alignItems: "baseline",
		padding: `${space.sm} 0`,
		borderBottomWidth: {
			default: measure.hairline,
			":last-child": 0,
		},
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
	},
	itemBody: {
		minWidth: 0,
		color: colours.inkMuted,
		fontSize: type.small,
		overflowWrap: "anywhere",
	},
	where: {
		marginLeft: "auto",
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.lane,
		whiteSpace: "nowrap",
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
});

const since = (time: string | null | undefined, now: number): string | null =>
	time === null || time === undefined ? null : spanText(now - Date.parse(time));

function Source({
	children,
	need = false,
	aggregate = false,
	next = false,
}: {
	children: string;
	need?: boolean;
	/** A source that Project Flow computes from its own store. */
	aggregate?: boolean;
	/** A source after another source in the same row. */
	next?: boolean;
}) {
	return (
		<span
			className={clsx(
				styles.source,
				need && styles.sourceNeed,
				aggregate && styles.sourceAggregate,
				next && styles.sourceNext,
			)}
		>
			{children}
		</span>
	);
}

function Card({
	title,
	source,
	aggregate,
	children,
	stretch = false,
	tools,
}: {
	title: string;
	source?: string;
	aggregate?: string;
	children: ReactNode;
	stretch?: boolean;
	/** Controls after the sources, at the end of the card head. */
	tools?: ReactNode;
}) {
	return (
		<section
			className={clsx(styles.card, stretch && styles.stretch)}
			aria-label={title}
		>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{title}</h2>
				{source === undefined ? null : <Source>{source}</Source>}
				{aggregate === undefined ? null : (
					<Source aggregate next={source !== undefined}>
						{aggregate}
					</Source>
				)}
				{tools}
			</div>
			{children}
		</section>
	);
}

const rangeChoices = rangeDays.map((days) => ({
	id: String(days),
	label: factoriesCopy.range(days),
}));

/** Picks the days that a chart of the Factories tab shows. */
function RangePicker({
	id,
	chart,
	days,
	onChange,
}: {
	id: string;
	chart: string;
	days: RangeDays;
	onChange: (days: RangeDays) => void;
}) {
	return (
		<Dropdown
			id={id}
			label={factoriesCopy.rangeLabel(chart)}
			value={String(days)}
			choices={rangeChoices}
			steadyWidth
			onChange={(choice) => {
				const picked = rangeDays.find((days) => String(days) === choice);
				if (picked !== undefined) {
					onChange(picked);
				}
			}}
		/>
	);
}

function Tile({
	label,
	value,
	detail,
	tone,
}: {
	label: string;
	value: string;
	detail: string;
	tone?: "warn" | "bad";
}) {
	return (
		<div className={clsx(styles.card)}>
			<div className={clsx(styles.kicker)}>{label}</div>
			<div
				className={clsx(
					styles.tileValue,
					tone === "warn" && styles.tileWarn,
					tone === "bad" && styles.tileBad,
				)}
			>
				{value}
			</div>
			<div className={clsx(styles.tileDetail)} title={detail}>
				{detail}
			</div>
		</div>
	);
}

function Tiles({ page, now }: { page: FactoriesPage; now: number }) {
	const { tiles } = page;
	const wait = since(tiles.longestWaitSince, now);
	return (
		<div className={clsx(styles.grid, styles.tiles)}>
			<Tile
				label={factoriesCopy.tiles.running}
				value={String(tiles.running)}
				detail={
					tiles.slots === null
						? factoriesCopy.noSlots
						: factoriesCopy.ofSlots(tiles.slots.total)
				}
			/>
			<Tile
				label={factoriesCopy.tiles.queued}
				value={String(tiles.queued)}
				detail={
					wait === null ? factoriesCopy.noWait : factoriesCopy.longestWait(wait)
				}
			/>
			<Tile
				label={factoriesCopy.tiles.attention}
				value={String(tiles.attention.total)}
				detail={factoriesCopy.attentionParts(
					tiles.attention.failed,
					tiles.attention.stalled,
					tiles.attention.asks,
				)}
				{...(tiles.attention.total > 0 ? { tone: "warn" as const } : {})}
			/>
			<Tile
				label={factoriesCopy.tiles.merged}
				value={String(tiles.merged.last)}
				detail={factoriesCopy.versus(tiles.merged.last - tiles.merged.before)}
			/>
			<Tile
				label={factoriesCopy.tiles.failures}
				value={String(tiles.failed.last)}
				detail={factoriesCopy.reasons(tiles.failed.reasons)}
				{...(tiles.failed.last > 0 ? { tone: "bad" as const } : {})}
			/>
			<Tile
				label={factoriesCopy.tiles.cost}
				value={`$${Math.round(tiles.cost.last)}`}
				detail={factoriesCopy.perMerged(
					tiles.cost.perMerged === null
						? null
						: costLabel(tiles.cost.perMerged),
				)}
			/>
		</div>
	);
}

const levelFill: Record<HostLevel, stylex.StyleXStyles> = {
	ok: styles.levelOk,
	warn: styles.levelWarn,
	bad: styles.levelBad,
};

const levelPill: Record<HostLevel, stylex.StyleXStyles> = {
	ok: styles.pillOk,
	warn: styles.pillWarn,
	bad: styles.pillBad,
};

const levelEdge: Record<HostLevel, stylex.StyleXStyles | false> = {
	ok: false,
	warn: styles.boxWarn,
	bad: styles.boxBad,
};

/** The load per core that fills the load meter. */
const fullLoadPerCore = 1.2;

const percent = (share: number) =>
	`${Math.max(0, Math.min(100, share * 100))}%`;

/** Bytes as gigabytes, with one decimal under 10 GB. */
const sizeText = (amount: number) =>
	amount < 10 ? amount.toFixed(1) : String(Math.round(amount));

const gigabytes = (bytes: number) => sizeText(bytes / 1e9);

const sizeUnits = ["GB", "TB", "PB", "EB"] as const;

/** Free and total bytes in the largest unit that keeps the total at 1 or more. */
function sizeOf(free: number, total: number) {
	const step = Math.max(
		0,
		Math.min(
			sizeUnits.length - 1,
			Math.floor(Math.log10(Math.max(total, 1) / 1e9) / 3),
		),
	);
	const scale = 1e9 * 1000 ** step;
	return {
		free: sizeText(free / scale),
		total: sizeText(total / scale),
		unit: sizeUnits[step] ?? "GB",
	};
}

/** A long mount path keeps its end, as the end names the folder. */
const mountLabel = (mount: string) =>
	mount === "/"
		? factoriesCopy.meters.disk
		: mount.length > 16
			? `...${mount.slice(-13)}`
			: mount;

function Meter({
	label,
	value,
	children,
	small = false,
	mono = false,
}: {
	label: string;
	value: string;
	children: ReactNode;
	small?: boolean;
	mono?: boolean;
}) {
	return (
		<div className={clsx(styles.meter, small && styles.meterSmall)}>
			<span className={clsx(mono && styles.mono)} title={label}>
				{label}
			</span>
			{children}
			<span className={clsx(styles.meterValue)}>{value}</span>
		</div>
	);
}

function Fill({ share, tone }: { share: number; tone: stylex.StyleXStyles }) {
	return <span {...stylex.props(styles.fill(percent(share)), tone)} />;
}

function Spark({ values }: { values: number[] }) {
	const width = 120;
	const height = 24;
	const top = Math.max(...values, Number.MIN_VALUE);
	const path = values
		.map(
			(value, index) =>
				`${index === 0 ? "M" : "L"}${((index / Math.max(1, values.length - 1)) * width).toFixed(1)},${(height - (value / top) * height).toFixed(1)}`,
		)
		.join("");
	return (
		<svg
			className={clsx(styles.spark)}
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			{values.length < 2 ? null : (
				<path className={clsx(styles.sparkLine)} d={path} />
			)}
		</svg>
	);
}

function worstNote(host: HostHealth): string | null {
	const worst = host.worst;
	if (worst === undefined) {
		return null;
	}
	const copy = factoriesCopy.worst;
	switch (worst.metric) {
		case "load":
			return copy.load(host.load.perCore.toFixed(2));
		case "gate":
			return copy.gate(host.load.m5.toFixed(1), String(host.load.gate ?? ""));
		case "cpu":
			return copy.cpu(host.cpu.busyPercent);
		case "memory":
			return copy.memory(gigabytes(host.memory.availableBytes));
		case "swap":
			return copy.swap(gigabytes(host.swap.usedBytes));
		case "disk": {
			const disk = host.disks.find((each) => each.mount === worst.mount);
			if (disk === undefined) {
				return null;
			}
			return disk.fullInS === null
				? copy.diskFree(disk.mount, gigabytes(disk.freeBytes))
				: copy.diskFull(disk.mount, roughSpanText(disk.fullInS * 1_000));
		}
	}
}

function DiskMeter({ disk }: { disk: HostDisk }) {
	const size = sizeOf(disk.freeBytes, disk.totalBytes);
	return (
		<Meter
			label={mountLabel(disk.mount)}
			mono={disk.mount !== "/"}
			value={factoriesCopy.diskValue(
				size,
				disk.fullInS === null ? null : roughSpanText(disk.fullInS * 1_000),
			)}
		>
			<span className={clsx(styles.bar)}>
				<Fill
					share={disk.totalBytes === 0 ? 0 : disk.usedBytes / disk.totalBytes}
					tone={levelFill[disk.level]}
				/>
			</span>
		</Meter>
	);
}

/** The meter rows of a box card in one grid, so every bar starts and ends at the same place. */
function HostMeters({
	host,
	children,
}: {
	host: HostHealth | undefined;
	children: ReactNode;
}) {
	return (
		<>
			<div className={clsx(styles.meters)}>
				{children}
				{host === undefined ? null : <HostRows host={host} />}
			</div>
			{host === undefined ? null : <HostFoot host={host} />}
		</>
	);
}

function HostFoot({ host }: { host: HostHealth }) {
	const note = worstNote(host);
	return (
		<>
			<div className={clsx(styles.legend)}>
				<span className={clsx(styles.legendItem)}>
					<span className={clsx(styles.swatch, styles.iowait)} />
					{factoriesCopy.iowait}
				</span>
				<span>
					{factoriesCopy.hostSize(
						host.cores,
						gigabytes(host.memory.totalBytes),
					)}
				</span>
			</div>
			{note === null ? null : (
				<p
					className={clsx(
						styles.note,
						host.level === "bad" ? styles.worstBad : styles.worstWarn,
					)}
				>
					{note}
				</p>
			)}
		</>
	);
}

function HostRows({ host }: { host: HostHealth }) {
	const { load, cpu, memory, swap } = host;
	const gateShare =
		load.gate === null ? null : load.gate / host.cores / fullLoadPerCore;
	return (
		<>
			<Meter
				label={factoriesCopy.meters.loadPerCore}
				value={factoriesCopy.loadPerCore(
					load.perCore.toFixed(2),
					load.m5.toFixed(1),
				)}
			>
				<span className={clsx(styles.bar, styles.gated)}>
					<Fill
						share={load.perCore / fullLoadPerCore}
						tone={levelFill[load.level]}
					/>
					{gateShare === null ? null : (
						<span
							{...stylex.props(styles.gate(percent(gateShare)))}
							title={factoriesCopy.gateMark(String(load.gate))}
						/>
					)}
				</span>
			</Meter>
			<Meter
				label={factoriesCopy.meters.loadHour}
				small
				value={[load.m1, load.m5, load.m15]
					.map((value) => value.toFixed(1))
					.join(" / ")}
			>
				<Spark values={load.hour} />
			</Meter>
			<Meter
				label={factoriesCopy.meters.cpu}
				value={factoriesCopy.cpuValue(cpu.busyPercent, cpu.iowaitPercent)}
			>
				<span className={clsx(styles.bar)}>
					<Fill share={cpu.busyPercent / 100} tone={levelFill[cpu.level]} />
					<Fill share={cpu.iowaitPercent / 100} tone={styles.iowait} />
				</span>
			</Meter>
			<Meter
				label={factoriesCopy.meters.memory}
				value={factoriesCopy.freeOf(
					sizeOf(memory.availableBytes, memory.totalBytes),
				)}
			>
				<span className={clsx(styles.bar)}>
					<Fill
						share={
							memory.totalBytes === 0
								? 0
								: 1 - memory.availableBytes / memory.totalBytes
						}
						tone={levelFill[memory.level]}
					/>
				</span>
			</Meter>
			<Meter
				label={factoriesCopy.meters.swap}
				value={factoriesCopy.freeOf(
					sizeOf(swap.totalBytes - swap.usedBytes, swap.totalBytes),
				)}
			>
				<span className={clsx(styles.bar)}>
					<Fill
						share={swap.totalBytes === 0 ? 0 : swap.usedBytes / swap.totalBytes}
						tone={styles.levelWarn}
					/>
				</span>
			</Meter>
			{host.disks.map((disk) => (
				<DiskMeter key={disk.mount} disk={disk} />
			))}
		</>
	);
}

/** A heartbeat older than a few factory checks means the box went quiet. */
const heartbeatFreshMs = 3 * factoryCheckMs;

/** A dot that beats once when a new heartbeat lands, and turns grey when the heartbeat goes stale. */
function HeartbeatDot({
	at,
	span,
	now,
}: {
	at: string | null;
	span: string;
	now: number;
}) {
	const fresh = at !== null && now - Date.parse(at) < heartbeatFreshMs;
	const label = factoriesCopy.heartbeat(span);
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className={clsx(styles.beat, fresh && styles.beatFresh)}
		/>
	);
}

/**
 * The box cards in bands: each hub that has boxes heads a band of its network,
 * and one band holds the standalone factories. Without a network, the cards
 * need no bands.
 */
function BoxBands({ page, now }: { page: FactoriesPage; now: number }) {
	const grid = (boxes: FactoryCard[], inBand: boolean) => (
		<div className={clsx(styles.grid, styles.boxes, inBand && styles.bandGrid)}>
			{boxes.map((box) => (
				<BoxCard key={box.name} box={box} page={page} now={now} />
			))}
		</div>
	);
	const members = Map.groupBy(
		page.boxes.filter((box) => box.network !== undefined),
		(box) => box.network,
	);
	const networks = page.boxes.filter((box) => members.has(box.name));
	if (networks.length === 0) {
		return grid(page.boxes, false);
	}
	const standalone = page.boxes.filter(
		(box) => box.network === undefined && !members.has(box.name),
	);
	return (
		<>
			{networks.map((hub) => {
				const boxes = members.get(hub.name) ?? [];
				return (
					<section
						key={hub.name}
						className={clsx(styles.band)}
						aria-label={hub.name}
					>
						<div className={clsx(styles.bandHead)}>
							<h2 className={clsx(styles.heading)}>{hub.name}</h2>
							<span className={clsx(styles.pill)}>{factoriesCopy.network}</span>
							<span className={clsx(styles.meta)}>
								{factoriesCopy.networkSummary(
									boxes.length,
									boxes.filter((box) => box.reachable === true).length,
								)}
								{hub.slots === undefined
									? null
									: `, ${factoriesCopy.busy(hub.slots.used, hub.slots.total)}`}
							</span>
						</div>
						{grid([hub, ...boxes], true)}
					</section>
				);
			})}
			{standalone.length === 0 ? null : (
				<section
					className={clsx(styles.band)}
					aria-label={factoriesCopy.standalone}
				>
					<div className={clsx(styles.bandHead)}>
						<h2 className={clsx(styles.heading)}>{factoriesCopy.standalone}</h2>
					</div>
					{grid(standalone, true)}
				</section>
			)}
		</>
	);
}

/** The last height of each box card while its factory answered, kept for the life of the page. */
const answeredHeights = new Map<string, number>();

/**
 * Measures a box card while its factory answers. When the factory stops answering,
 * the card keeps that height, so the cards around it do not move.
 */
function useKeptHeight(name: string, answers: boolean) {
	const ref = useRef<HTMLElement>(null);
	const [kept, setKept] = useState(() => answeredHeights.get(name));
	useLayoutEffect(() => {
		const card = ref.current;
		if (!answers || card === null) {
			return;
		}
		const observer = new ResizeObserver(() => {
			answeredHeights.set(name, card.offsetHeight);
			setKept(card.offsetHeight);
		});
		observer.observe(card);
		return () => observer.disconnect();
	}, [name, answers]);
	return {
		ref,
		style: !answers && kept !== undefined && styles.keptHeight(`${kept}px`),
	};
}

function BoxCard({
	box,
	page,
	now,
}: {
	box: FactoryCard;
	page: FactoriesPage;
	now: number;
}) {
	const heartbeat = since(box.heartbeatAt, now);
	const off = box.reachable !== true;
	const host = off ? undefined : box.host;
	const hostNotServed = page.notServed.some(
		(item) => item.panel === "host" && item.factory === box.name,
	);
	const hubSilent =
		box.hub !== undefined &&
		page.boxes.find((other) => other.name === box.hub)?.reachable !== true;
	const dormant =
		!hubSilent && (box.state === "asleep" || box.state === "waking")
			? box.state
			: null;
	const slotTotal = box.slots?.total ?? 0;
	const kept = useKeptHeight(box.name, !off);
	return (
		<section
			ref={kept.ref}
			{...stylex.props(
				styles.card,
				styles.box,
				host !== undefined && levelEdge[host.level],
				off && styles.boxOff,
				kept.style,
			)}
			aria-label={box.name}
		>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{box.name}</h2>
				{box.roles.map((role) => (
					<span key={role} className={clsx(styles.pill)}>
						{factoriesCopy.role[role]}
					</span>
				))}
				{dormant !== null ? (
					<span className={clsx(styles.pill)}>
						{factoriesCopy.boxState[dormant]}
					</span>
				) : off ? (
					<span className={clsx(styles.pill, styles.pillBad)}>
						{factoriesCopy.noAnswer}
					</span>
				) : host === undefined ? null : (
					<span className={clsx(styles.pill, levelPill[host.level])}>
						{factoriesCopy.level[host.level]}
					</span>
				)}
				{box.state === "stopping" ? (
					<span className={clsx(styles.pill)}>
						{factoriesCopy.boxState.stopping}
					</span>
				) : null}
				{dormant !== null ? null : (
					<span className={clsx(styles.meta)}>
						{host === undefined
							? null
							: factoriesCopy.uptime(spanText(host.uptimeS * 1_000))}
						{heartbeat === null ? (
							factoriesCopy.noHeartbeat
						) : (
							<HeartbeatDot
								key={box.heartbeatAt}
								at={box.heartbeatAt}
								span={heartbeat}
								now={now}
							/>
						)}
					</span>
				)}
			</div>
			<div className={clsx(styles.sourceRow)}>
				{box.hub === undefined ? (
					<>
						<Source>{factoriesCopy.sources.daemon}</Source>
						<Source next>{factoriesCopy.hostSource}</Source>
					</>
				) : (
					<Source>{factoriesCopy.poolSource}</Source>
				)}
			</div>
			{dormant === "asleep" ? (
				<p className={clsx(styles.note)}>
					{factoriesCopy.asleep(slotTotal, heartbeat)}
				</p>
			) : dormant === "waking" ? (
				<p className={clsx(styles.note)}>{factoriesCopy.waking(slotTotal)}</p>
			) : off ? (
				<p className={clsx(styles.note)}>
					{box.hub === undefined
						? factoriesCopy.unreachable(heartbeat !== null)
						: hubSilent
							? factoriesCopy.hubSilent
							: factoriesCopy.boxUnreachable(heartbeat !== null)}
				</p>
			) : (
				<HostMeters host={host}>
					{box.slots === undefined ? (
						<p className={clsx(styles.note, styles.meterSpan)}>
							{factoriesCopy.noSlotCount}
						</p>
					) : (
						<Meter
							label={factoriesCopy.slots}
							value={factoriesCopy.busy(box.slots.used, box.slots.total)}
						>
							<span className={clsx(styles.bar)}>
								<Fill
									share={
										box.slots.total === 0
											? 0
											: Math.min(1, box.slots.used / box.slots.total)
									}
									tone={styles.stepCurrent}
								/>
							</span>
						</Meter>
					)}
					{host !== undefined ? null : hostNotServed ? (
						<div className={clsx(styles.meterSpan)}>
							<NotServed page={page} panel="host" factory={box.name} />
						</div>
					) : (
						<p className={clsx(styles.note, styles.meterSpan)}>
							{factoriesCopy.noHostSample}
						</p>
					)}
				</HostMeters>
			)}
		</section>
	);
}

const stepStyle: Record<RunGraphNodeState, stylex.StyleXStyles | false> = {
	completed: styles.stepDone,
	current: styles.stepCurrent,
	failed: styles.stepFailed,
	ahead: false,
};

const checkpointRetries = 20;
const checkpointRetryMs = 500;

const agentKind = "codergen";
const exitKind = "exit";

/**
 * The agent stages of a run, one each: the done stages in the order of their first
 * visit, the current stage, then the stages ahead on the default path.
 */
function stepsOf(graph: RunGraph, completedStages: string[]) {
	const top = new Map(
		graph.nodes
			.filter((node) => !node.id.includes("/"))
			.map((node) => [node.id, node]),
	);
	const isAgent = (id: string) => top.get(id)?.kind === agentKind;
	const done = [...new Set(completedStages)].filter(
		(id) => isAgent(id) && top.get(id)?.state === "completed",
	);
	const current = [...top.values()].find(
		(node) => node.state === "current" || node.state === "failed",
	);
	const ahead: string[] = [];
	const seen = new Set<string>();
	let at = current?.id;
	while (at !== undefined && !seen.has(at) && top.get(at)?.kind !== exitKind) {
		seen.add(at);
		const from = at;
		const out = graph.edges.filter((edge) => edge.from === from);
		at = (out.find((edge) => edge.condition === undefined) ?? out[0])?.to;
		if (at !== undefined && isAgent(at) && top.get(at)?.state === "ahead") {
			ahead.push(at);
		}
	}
	return [
		...done,
		...(current === undefined || done.includes(current.id) ? [] : [current.id]),
		...ahead,
	].flatMap((id) => {
		const node = top.get(id);
		return node === undefined ? [] : [node];
	});
}

/** One block for each agent stage of the run, from its checkpoint. */
function Stepper({ run }: { run: RunningRun }) {
	// The first read of a checkpoint answers pending while the factory read runs.
	const checkpoint = useQuery({
		...pageQuery.checkpoint(run),
		retry: checkpointRetries,
		retryDelay: checkpointRetryMs,
	});
	const read = checkpoint.data;
	const nodes =
		read === undefined || typeof read === "string" || read.graph === null
			? []
			: stepsOf(read.graph, read.completedStages);
	return (
		<span className={clsx(styles.steps)}>
			{nodes.map((node) => (
				<span
					key={node.id}
					title={node.label}
					className={clsx(
						styles.step,
						node.state === "current" && run.stall !== undefined
							? styles.stepStalled
							: stepStyle[node.state],
					)}
				/>
			))}
		</span>
	);
}

/** What the run agent of the current stage does now, read only while the tab is open. */
function AgentWork({ run }: { run: RunningRun }) {
	const agents = useQuery(pageQuery.agents(run));
	const agent =
		agents.data?.find((item) => item.stage === run.stage) ?? agents.data?.[0];
	if (agent === undefined) {
		return null;
	}
	const work = agent.lastMessage ?? "";
	return (
		<span className={clsx(styles.agent, styles.clamp)} title={work}>
			{agent.tool === null ? work : `${agent.tool}: ${work}`}
		</span>
	);
}

function RunningTable({ runs, now }: { runs: RunningRun[]; now: number }) {
	if (runs.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noRunning}</p>;
	}
	const { columns } = factoriesCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.ticket}</th>
						<th className={clsx(styles.th)}>{columns.factory}</th>
						<th className={clsx(styles.th)}>{columns.stages}</th>
						<th className={clsx(styles.th)}>{columns.stage}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.inStage}
						</th>
						<th className={clsx(styles.th, styles.number)}>{columns.total}</th>
						<th className={clsx(styles.th)}>{columns.agent}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.cost}</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run, index) => {
						const last = index === runs.length - 1;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr key={run.id} className={clsx(styles.row)}>
								<td className={cell()}>
									<a
										href={runPagePath(run.id)}
										className={clsx(styles.link, ...textControl)}
									>
										{ticketLabel(run.key)}
									</a>
								</td>
								<td className={cell()}>{run.factory}</td>
								<td className={cell()}>
									<Stepper run={run} />
								</td>
								<td className={cell(styles.wrap)}>
									{run.stage}
									{run.stall === undefined ? null : (
										<span
											className={clsx(
												styles.pill,
												styles.pillWarn,
												styles.stagePill,
											)}
										>
											{factoriesCopy.pastP95}
										</span>
									)}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(run.stageSince, now)}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(run.startedAt, now)}
								</td>
								<td className={cell()}>
									<AgentWork run={run} />
								</td>
								<td className={cell(styles.number)}>
									{run.costUsd === undefined ? null : costLabel(run.costUsd)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

const kindPill: Record<AttentionItem["kind"], stylex.StyleXStyles> = {
	failed: styles.pillBad,
	stalled: styles.pillWarn,
	ask: styles.pillInfo,
};

/** A stalled run names its stage, its time in the stage and the p95 that it passed. */
function reasonOf(item: AttentionItem, now: number): string {
	if (item.p95S === undefined) {
		return item.reason;
	}
	const p95Ms = item.p95S * 1_000;
	return factoriesCopy.stalledReason(
		item.reason,
		spanText(now - Date.parse(item.since) + p95Ms),
		spanText(p95Ms),
	);
}

function AttentionList({
	items,
	now,
}: {
	items: AttentionItem[];
	now: number;
}) {
	if (items.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noAttention}</p>;
	}
	return (
		<ul className={clsx(styles.list)}>
			{items.map((item) => (
				<li
					key={`${item.kind} ${item.runId} ${item.reason}`}
					className={clsx(styles.item)}
				>
					<span className={clsx(styles.pill, kindPill[item.kind])}>
						{factoriesCopy.kind[item.kind]}
					</span>
					<span className={clsx(styles.itemBody)}>
						<a
							href={runPagePath(item.runId)}
							className={clsx(styles.link, ...textControl)}
						>
							{ticketLabel(item.key)}
						</a>
						<span className={clsx(styles.clamp)} title={reasonOf(item, now)}>
							{reasonOf(item, now)}
						</span>
					</span>
					<span className={clsx(styles.where)}>{since(item.since, now)}</span>
				</li>
			))}
		</ul>
	);
}

function QueueTable({ items, now }: { items: QueueItem[]; now: number }) {
	if (items.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noQueue}</p>;
	}
	const { columns } = factoriesCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.rank}</th>
						<th className={clsx(styles.th)}>{columns.ticket}</th>
						<th className={clsx(styles.th, styles.wide)}>{columns.source}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.waiting}
						</th>
						<th className={clsx(styles.th)}>{columns.waitsOn}</th>
					</tr>
				</thead>
				<tbody>
					{items.map((item, index) => {
						const last = index === items.length - 1;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr
								key={`${item.factory} ${item.source} ${item.key}`}
								className={clsx(styles.row)}
							>
								<td className={cell()}>{item.rank}</td>
								<td className={cell(styles.nowrap)}>
									{item.url === undefined ? (
										ticketLabel(item.key)
									) : (
										<a
											href={item.url}
											target="_blank"
											rel="noreferrer"
											className={clsx(styles.link, ...textControl)}
										>
											{ticketLabel(item.key)}
										</a>
									)}
								</td>
								<td className={cell(styles.wide)}>
									{`${item.factory}: ${item.source}`}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(item.since, now)}
								</td>
								<td className={cell()}>
									{item.hold === undefined
										? item.waits
										: factoriesCopy.held(item.hold.failures)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function NotServed({
	page,
	panel,
	factory,
}: {
	page: FactoriesPage;
	panel: NotServedPanel["panel"];
	factory?: string;
}) {
	return page.notServed
		.filter(
			(item) =>
				item.panel === panel &&
				(factory === undefined || item.factory === factory),
		)
		.map((item) => (
			<p key={item.factory} className={clsx(styles.note)}>
				{factoriesCopy.notServed(item.factory, item.route)}
			</p>
		));
}

const outcomeKinds = ["merged", "failed", "stopped"] as const;

const dayLabel = (day: string) =>
	new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

function OutcomeChart({ days }: { days: DayOutcome[] }) {
	const most = Math.max(
		1,
		...days.map((day) => day.merged + day.failed + day.stopped),
	);
	const first = days[0];
	return (
		<>
			<div className={clsx(styles.chart)}>
				{days.map((day) => (
					<div
						key={day.day}
						className={clsx(styles.day)}
						title={factoriesCopy.dayOutcome(dayLabel(day.day), day)}
					>
						{outcomeKinds.map((kind) => (
							<span
								key={kind}
								{...stylex.props(
									styles.segment(`${(day[kind] / most) * 100}%`),
									styles[kind],
								)}
							/>
						))}
					</div>
				))}
			</div>
			<div className={clsx(styles.axis)}>
				<span>{first === undefined ? null : dayLabel(first.day)}</span>
				<span>{factoriesCopy.today}</span>
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

function StageTable({
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
						<th className={clsx(styles.th, styles.spreadColumn, styles.wide)}>
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
									<span className={clsx(styles.spread)}>
										<span
											{...stylex.props(styles.spreadP50(share(stage.p50S)))}
										/>
										<span
											{...stylex.props(
												styles.spreadP95(share(stage.p95S - stage.p50S)),
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
				<div className={clsx(styles.more)}>
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

export function Page() {
	const [outcomes, setOutcomes] = useState<RangeDays>(outcomeDays);
	const [stages, setStages] = useState<RangeDays>(stageDays);
	const query = useQuery(pageQuery.factories(outcomes, stages));
	const now = useNow(1_000);
	const page = query.data;
	return (
		<PageFrame title={navLabel.factories} subtitle={factoriesCopy.subtitle}>
			{page === undefined ? (
				<PageLoading />
			) : (
				<>
					<Tiles page={page} now={now} />
					<BoxBands page={page} now={now} />
					<div className={clsx(styles.grid, styles.two)}>
						<Card
							title={factoriesCopy.running}
							source={factoriesCopy.sources.running}
						>
							<RunningTable runs={page.running} now={now} />
							<p className={clsx(styles.note)}>{factoriesCopy.runningNote}</p>
						</Card>
						<Card
							title={factoriesCopy.attention}
							source={factoriesCopy.sources.attention}
							stretch
						>
							<AttentionList items={page.attention} now={now} />
						</Card>
					</div>
					<div className={clsx(styles.grid)}>
						<Card
							title={factoriesCopy.outcomes}
							aggregate={factoriesCopy.sources.outcomes}
							tools={
								<RangePicker
									id="factories-outcome-days"
									chart={factoriesCopy.outcomes}
									days={outcomes}
									onChange={setOutcomes}
								/>
							}
						>
							<OutcomeChart days={page.outcomes} />
						</Card>
						<Card
							title={factoriesCopy.stageDurations}
							source={factoriesCopy.sources.stageEvents}
							aggregate={factoriesCopy.sources.stageAggregate}
							tools={
								<RangePicker
									id="factories-stage-days"
									chart={factoriesCopy.stageDurations}
									days={stages}
									onChange={setStages}
								/>
							}
						>
							<StageTable stages={page.stages} days={stages} />
						</Card>
						<Card
							title={factoriesCopy.queue}
							source={factoriesCopy.sources.queue}
						>
							<QueueTable items={page.queue} now={now} />
							<NotServed page={page} panel="queue" />
						</Card>
					</div>
				</>
			)}
		</PageFrame>
	);
}
