import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { styles } from "./factories-parts.tsx";
import { factoriesCopy, roughSpanText } from "./factories-terms.ts";
import type { HostDisk, HostHealth, HostLevel } from "./host-health.ts";
import { colours, font, measure, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

export const hostMeterStyles = stylex.create({
	boxWarn: {
		borderLeftColor: colours.warn,
	},
	boxBad: {
		borderLeftColor: colours.danger,
	},
	pillOk: {
		backgroundColor: colours.okWash,
		color: colours.awaitingMerge,
	},
	meters: {
		display: "grid",
		gridTemplateColumns: `${measure.meterLabel} minmax(0, 1fr) max-content`,
		columnGap: space.sm,
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
	fill: (share: string) => ({
		width: share,
		height: "100%",
		backgroundColor: colours.accent,
	}),
	levelOk: {
		backgroundColor: colours.awaitingMerge,
	},
	levelBad: {
		backgroundColor: colours.danger,
	},
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
	meterValue: {
		color: colours.inkMuted,
		textAlign: "right",
		whiteSpace: "nowrap",
		fontVariantNumeric: "tabular-nums",
	},
});

export const levelFill: Record<HostLevel, stylex.StyleXStyles> = {
	ok: hostMeterStyles.levelOk,
	warn: styles.levelWarn,
	bad: hostMeterStyles.levelBad,
};

export const levelPill: Record<HostLevel, stylex.StyleXStyles> = {
	ok: hostMeterStyles.pillOk,
	warn: styles.pillWarn,
	bad: styles.pillBad,
};

export const levelEdge: Record<HostLevel, stylex.StyleXStyles | false> = {
	ok: false,
	warn: hostMeterStyles.boxWarn,
	bad: hostMeterStyles.boxBad,
};

/** The load per core that fills the load meter. */
export const fullLoadPerCore = 1.2;

export const percent = (share: number) =>
	`${Math.max(0, Math.min(100, share * 100))}%`;

/** Bytes as gigabytes, with one decimal under 10 GB. */
const sizeText = (amount: number) =>
	amount < 10 ? amount.toFixed(1) : String(Math.round(amount));

export const gigabytes = (bytes: number) => sizeText(bytes / 1e9);

const sizeUnits = ["GB", "TB", "PB", "EB"] as const;

/** Free and total bytes in the largest unit that keeps the total at 1 or more. */
export function sizeOf(free: number, total: number) {
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

export function Meter({
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
		<div
			className={clsx(
				hostMeterStyles.meter,
				small && hostMeterStyles.meterSmall,
			)}
		>
			<span className={clsx(mono && hostMeterStyles.mono)} title={label}>
				{label}
			</span>
			{children}
			<span className={clsx(hostMeterStyles.meterValue)}>{value}</span>
		</div>
	);
}

export function Fill({
	share,
	tone,
}: {
	share: number;
	tone: stylex.StyleXStyles;
}) {
	return <span {...stylex.props(hostMeterStyles.fill(percent(share)), tone)} />;
}

export function Spark({ values }: { values: number[] }) {
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
			className={clsx(hostMeterStyles.spark)}
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			{values.length < 2 ? null : (
				<path className={clsx(hostMeterStyles.sparkLine)} d={path} />
			)}
		</svg>
	);
}

export function worstNote(host: HostHealth): string | null {
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
			const name = disk.mount === "/" ? factoriesCopy.meters.disk : disk.mount;
			return disk.fullInS === null
				? copy.diskFree(name, gigabytes(disk.freeBytes))
				: copy.diskFull(name, roughSpanText(disk.fullInS * 1_000));
		}
	}
}

export function DiskMeter({ disk }: { disk: HostDisk }) {
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
