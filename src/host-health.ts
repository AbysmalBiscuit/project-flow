import type { HostSnapshot } from "./factory-host.ts";

/** The colour of a metric and of a box card: green, amber or red. */
export type HostLevel = "ok" | "warn" | "bad";

/** A metric that can colour a box card. `gate` is the placement gate on the load meter. */
export type HostMetric = "load" | "gate" | "cpu" | "memory" | "swap" | "disk";

export type HostDisk = {
	mount: string;
	holds: string[];
	totalBytes: number;
	usedBytes: number;
	freeBytes: number;
	/** The seconds until the mount is full, from the growth of its used space. Null with no growth. */
	fullInS: number | null;
	level: HostLevel;
};

/** The host health of one box: its last host sample, with the level of each metric. */
export type HostHealth = {
	takenAt: string;
	uptimeS: number;
	cores: number;
	load: {
		m1: number;
		m5: number;
		m15: number;
		/** The 5-minute load average for each core. */
		perCore: number;
		/** The 5-minute load average at which the factory stops taking new runs. */
		gate: number | null;
		/** The 1-minute load average of each sample of the last hour, oldest first. */
		hour: number[];
		level: HostLevel;
	};
	cpu: { busyPercent: number; iowaitPercent: number; level: HostLevel };
	memory: { totalBytes: number; availableBytes: number; level: HostLevel };
	swap: { totalBytes: number; usedBytes: number; level: HostLevel };
	disks: HostDisk[];
	/** The level of the worst metric. */
	level: HostLevel;
	/** The worst metric, on a card that is not green. A disk names its mount. */
	worst?: { metric: HostMetric; mount?: string };
};

/** One host sample at the clock time `at`. */
export type TimedSnapshot = { at: string; snapshot: HostSnapshot };

const hourMs = 60 * 60 * 1_000;

/** The span of samples that the sparkline covers. */
export const sparkSpanMs = hourMs;

/** The span of samples that the time until full fits. */
export const growthSpanMs = 6 * hourMs;

const rank: Record<HostLevel, number> = { ok: 0, warn: 1, bad: 2 };

/** `warnAt` and `badAt` bound a metric that is worse when higher. */
function rising(value: number, warnAt: number, badAt: number): HostLevel {
	return value >= badAt ? "bad" : value >= warnAt ? "warn" : "ok";
}

function diskLevel(freeShare: number, fullInS: number | null): HostLevel {
	const within = (hours: number) =>
		fullInS !== null && fullInS <= hours * 3_600;
	if (freeShare < 0.05 || (freeShare < 0.2 && within(4))) {
		return "bad";
	}
	return freeShare < 0.4 && within(24) ? "warn" : "ok";
}

/**
 * The seconds until full: a least-squares line through the used bytes of the
 * samples, run forward until it uses the free bytes. Null when the line does not rise.
 */
function fullIn(
	points: { s: number; used: number }[],
	free: number,
): number | null {
	if (points.length < 2) {
		return null;
	}
	const meanS = points.reduce((sum, point) => sum + point.s, 0) / points.length;
	const meanUsed =
		points.reduce((sum, point) => sum + point.used, 0) / points.length;
	const spread = points.reduce((sum, point) => sum + (point.s - meanS) ** 2, 0);
	if (spread === 0) {
		return null;
	}
	const slope =
		points.reduce(
			(sum, point) => sum + (point.s - meanS) * (point.used - meanUsed),
			0,
		) / spread;
	return slope > 0 ? Math.round(free / slope) : null;
}

/**
 * The host health of a box from its samples, oldest first. The last sample gives
 * the values; the samples of the last hour give the sparkline, and the samples of the
 * last 6 hours give the time until full of each mount.
 */
export function hostHealth(
	samples: readonly TimedSnapshot[],
	gate: number | null,
	now: Date,
): HostHealth | undefined {
	const last = samples.at(-1)?.snapshot;
	if (last === undefined) {
		return undefined;
	}
	const since = (spanMs: number) =>
		samples.filter((sample) => now.getTime() - Date.parse(sample.at) <= spanMs);
	const growth = since(growthSpanMs);
	const { cpu, memory } = last;
	const perCore = cpu.load_5m / Math.max(1, cpu.cores);
	const disks = last.disks.map((disk): HostDisk => {
		const fullInS = fullIn(
			growth.flatMap((sample) => {
				const used = sample.snapshot.disks.find(
					(other) => other.mount === disk.mount,
				)?.used_bytes;
				return used === undefined
					? []
					: [{ s: Date.parse(sample.at) / 1_000, used }];
			}),
			disk.free_bytes,
		);
		return {
			mount: disk.mount,
			holds: disk.holds,
			totalBytes: disk.total_bytes,
			usedBytes: disk.used_bytes,
			freeBytes: disk.free_bytes,
			fullInS,
			level: diskLevel(
				disk.total_bytes === 0 ? 1 : disk.free_bytes / disk.total_bytes,
				fullInS,
			),
		};
	});
	const availableShare =
		memory.total_bytes === 0 ? 1 : memory.available_bytes / memory.total_bytes;
	const health = {
		takenAt: last.taken_at,
		uptimeS: last.uptime_seconds,
		cores: cpu.cores,
		load: {
			m1: cpu.load_1m,
			m5: cpu.load_5m,
			m15: cpu.load_15m,
			perCore,
			gate,
			hour: since(sparkSpanMs).map((sample) => sample.snapshot.cpu.load_1m),
			level: rising(perCore, 0.7, 1),
		},
		cpu: {
			busyPercent: cpu.busy_percent,
			iowaitPercent: cpu.iowait_percent,
			level: rising(cpu.busy_percent, 75, 90),
		},
		memory: {
			totalBytes: memory.total_bytes,
			availableBytes: memory.available_bytes,
			level:
				availableShare < 0.1 ? "bad" : availableShare < 0.15 ? "warn" : "ok",
		},
		swap: {
			totalBytes: memory.swap_total_bytes,
			usedBytes: memory.swap_used_bytes,
			level:
				memory.swap_used_bytes > 0.1 * memory.swap_total_bytes ? "warn" : "ok",
		},
		disks,
	} satisfies Omit<HostHealth, "level" | "worst">;
	const metrics: { metric: HostMetric; level: HostLevel; mount?: string }[] = [
		{ metric: "load", level: health.load.level },
		{
			metric: "gate",
			level: gate !== null && cpu.load_5m >= gate ? "warn" : "ok",
		},
		{ metric: "cpu", level: health.cpu.level },
		{ metric: "memory", level: health.memory.level },
		{ metric: "swap", level: health.swap.level },
		...disks.map((disk) => ({
			metric: "disk" as const,
			level: disk.level,
			mount: disk.mount,
		})),
	];
	const worst = metrics.reduce((left, right) =>
		rank[right.level] > rank[left.level] ? right : left,
	);
	return {
		...health,
		level: worst.level,
		...(worst.level === "ok"
			? {}
			: {
					worst: {
						metric: worst.metric,
						...(worst.mount === undefined ? {} : { mount: worst.mount }),
					},
				}),
	};
}
