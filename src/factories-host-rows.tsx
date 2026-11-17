import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import {
	DiskMeter,
	Fill,
	fullLoadPerCore,
	gigabytes,
	hostMeterStyles,
	levelFill,
	Meter,
	percent,
	sizeOf,
	Spark,
	worstNote,
} from "./factories-host-meters.tsx";
import { factoryCheckMs } from "./factories-page.ts";
import { styles } from "./factories-parts.tsx";
import { factoriesCopy } from "./factories-terms.ts";
import type { HostHealth } from "./host-health.ts";
import { colours, measure, radius } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const beat = stylex.keyframes({
	"0%": { transform: "scale(1)" },
	"30%": { transform: "scale(1.8)" },
	"100%": { transform: "scale(1)" },
});

const hostRowStyles = stylex.create({
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
	worstWarn: {
		color: colours.warn,
	},
	worstBad: {
		color: colours.danger,
	},
});

/** The meter rows of a box card in one grid, so every bar starts and ends at the same place. */
export function HostMeters({
	host,
	children,
}: {
	host: HostHealth | undefined;
	children: ReactNode;
}) {
	return (
		<>
			<div className={clsx(hostMeterStyles.meters)}>
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
					<span className={clsx(styles.swatch, hostRowStyles.iowait)} />
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
						host.level === "bad"
							? hostRowStyles.worstBad
							: hostRowStyles.worstWarn,
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
				<span className={clsx(styles.bar, hostRowStyles.gated)}>
					<Fill
						share={load.perCore / fullLoadPerCore}
						tone={levelFill[load.level]}
					/>
					{gateShare === null ? null : (
						<span
							{...stylex.props(hostRowStyles.gate(percent(gateShare)))}
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
					<Fill share={cpu.iowaitPercent / 100} tone={hostRowStyles.iowait} />
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
export function HeartbeatDot({
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
			className={clsx(hostRowStyles.beat, fresh && hostRowStyles.beatFresh)}
		/>
	);
}
