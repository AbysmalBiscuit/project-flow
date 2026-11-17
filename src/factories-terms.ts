import { hostRoute, poolRoute } from "./factory-host.ts";

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

/** A span of time in its largest whole unit, such as `40m`, `5h` or `9d`, for an estimate. */
export function roughSpanText(ms: number): string {
	const span = Math.max(0, ms);
	if (span < hourMs) {
		return `${Math.floor(span / minuteMs)}m`;
	}
	return span < dayMs
		? `${Math.floor(span / hourMs)}h`
		: `${Math.floor(span / dayMs)}d`;
}

/** A span of time as the Factories tab shows it, such as `14m`, `3h 23m` or `2d 4h`. */
export function spanText(ms: number): string {
	const span = Math.max(0, ms);
	if (span < minuteMs) {
		return `${Math.floor(span / 1_000)}s`;
	}
	if (span < hourMs) {
		return `${Math.floor(span / minuteMs)}m`;
	}
	if (span < dayMs) {
		const minutes = Math.floor((span % hourMs) / minuteMs);
		return `${Math.floor(span / hourMs)}h ${String(minutes).padStart(2, "0")}m`;
	}
	return `${Math.floor(span / dayMs)}d ${Math.floor((span % dayMs) / hourMs)}h`;
}

export const plural = (count: number, one: string, many: string): string =>
	`${count} ${count === 1 ? one : many}`;

export const factoriesCopy = {
	subtitle: "What runs now, what needs you, and how much room each box has.",
	tiles: {
		running: "Running",
		queued: "Queued",
		attention: "Needs attention",
		merged: "Merged, 24h",
		failures: "Failures, 24h",
		cost: "Cost, 24h",
	},
	ofSlots: (total: number): string => `of ${plural(total, "slot", "slots")}`,
	noSlots: "no factory reports slots",
	longestWait: (span: string): string => `longest wait ${span}`,
	noWait: "nothing waits",
	attentionParts: (failed: number, stalled: number, asks: number): string =>
		`${failed} failed, ${stalled} stalled, ${plural(asks, "question", "questions")}`,
	versus: (change: number): string =>
		`${change > 0 ? "+" : ""}${change} vs previous 24h`,
	reasons: (reasons: readonly { reason: string; count: number }[]): string =>
		reasons.length === 0
			? "no failures"
			: reasons.map(({ reason, count }) => `${count} ${reason}`).join(", "),
	perMerged: (cost: string | null): string =>
		cost === null ? "no merged PR" : `${cost} per merged PR`,
	role: { hub: "hub", daemon: "daemon" },
	network: "network",
	standalone: "Standalone",
	networkSummary: (boxes: number, awake: number): string =>
		`${boxes} ${boxes === 1 ? "box" : "boxes"}, ${awake} awake`,
	heartbeat: (span: string): string => `heartbeat ${span} ago`,
	uptime: (span: string): string => `up ${span}`,
	noHeartbeat: "no heartbeat yet",
	noAnswer: "does not answer",
	unreachable: (answered: boolean): string =>
		answered
			? "The factory does not answer."
			: "The factory has not answered yet.",
	boxUnreachable: (answered: boolean): string =>
		answered
			? "The box does not answer its hub."
			: "The box has not answered its hub yet.",
	hubSilent: "Its hub does not answer.",
	boxState: { asleep: "asleep", waking: "waking", stopping: "stopping" },
	asleep: (slots: number, span: string | null): string =>
		`Asleep with ${plural(slots, "slot", "slots")}${span === null ? "" : `, last contact ${span} ago`}. The hub wakes it when the queue needs slots.`,
	waking: (slots: number): string =>
		`Waking with ${plural(slots, "slot", "slots")}. The hub woke it for the queue.`,
	poolSource: `GET ${poolRoute}`,
	slots: "Slots",
	busy: (used: number, total: number): string =>
		used > total
			? `${total} / ${total} busy (+${used - total})`
			: `${used} / ${total} busy`,
	noSlotCount: "The factory reports no slots.",
	sources: {
		daemon: "GET /daemon",
		running: "GET /runs, /checkpoint, /workers",
		attention: "GET /runs, /questions",
		queue: "GET /sources, /holds",
		outcomes: "project-flow from GET /runs",
		stageEvents: "stage.completed events",
		stageAggregate: "project-flow aggregate",
	},
	hostSource: `GET ${hostRoute}`,
	noHostSample: "No host sample in the last minute.",
	level: { ok: "healthy", warn: "watch", bad: "trouble" },
	meters: {
		loadPerCore: "Load / core, 5m",
		loadHour: "Load 1h, 1/5/15m",
		cpu: "CPU",
		memory: "Memory",
		swap: "Swap",
		disk: "Disk",
	},
	loadPerCore: (perCore: string, load: string): string =>
		`${perCore} (${load})`,
	cpuValue: (busy: number, iowait: number): string =>
		`${busy}%, iowait ${iowait}%`,
	freeOf: (size: { free: string; total: string; unit: string }): string =>
		`${size.free} / ${size.total} ${size.unit} free`,
	diskValue: (
		size: { free: string; total: string; unit: string },
		fullIn: string | null,
	): string =>
		`${size.free} / ${size.total} ${size.unit} free, ${fullIn === null ? "no growth" : `full in ~${fullIn}`}`,
	iowait: "iowait",
	hostSize: (cores: number, gb: string): string =>
		`${plural(cores, "core", "cores")}, ${gb} GB RAM`,
	gateMark: (gate: string): string => `placement gate ${gate}`,
	worst: {
		load: (perCore: string): string => `5m load per core ${perCore} is high`,
		gate: (load: string, gate: string): string =>
			`5m load ${load} is past the placement gate of ${gate}`,
		cpu: (busy: number): string => `CPU is ${busy}% busy`,
		memory: (gb: string): string => `Only ${gb} GB of memory is available`,
		swap: (gb: string): string => `${gb} GB of swap is in use`,
		diskFull: (disk: string, span: string): string =>
			`${disk} fills in about ${span}`,
		diskFree: (disk: string, gb: string): string => `${disk} has ${gb} GB free`,
	},
	running: "Running now",
	runningNote:
		"Amber: the current stage runs past its p95 over the last 30 days, and for at least 10 minutes. Longest-running first. The times count up in the page.",
	pastP95: "past p95",
	noRunning: "No run runs now.",
	columns: {
		ticket: "Ticket",
		factory: "Factory",
		stages: "Stages",
		stage: "Current stage",
		inStage: "In stage",
		total: "Total",
		agent: "Agent",
		cost: "Cost",
		rank: "#",
		source: "Source",
		waiting: "Waiting",
		waitsOn: "Waits on",
		stageName: "Stage",
		role: "Role",
		runs: "Runs",
		p50: "p50",
		p95: "p95",
		spread: "p50 (dark) to p95 (light)",
		retries: "Retries / run",
		costPerRun: "Cost / run",
	},
	attention: "Needs attention",
	noAttention: "Nothing needs you.",
	kind: { failed: "failed", stalled: "stalled", ask: "question" },
	stalledReason: (stage: string, inStage: string, p95: string): string =>
		`${stage} ran ${inStage}, its p95 is ${p95}`,
	outcomes: "Outcomes",
	range: (days: number): string => `last ${days} days`,
	rangeLabel: (chart: string): string => `Days of ${chart}`,
	pageSize: (rows: number): string => `${rows} per page`,
	pageSizeLabel: (list: string): string => `Rows per page of ${list}`,
	pager: {
		previous: "Previous page",
		next: "Next page",
		page: (list: string): string => `Page of ${list}`,
		of: (pages: number): string => `of ${pages}`,
	},
	runsAxis: "runs",
	outcome: { merged: "merged", failed: "failed", stopped: "stopped" },
	today: "today",
	dayOutcome: (
		label: string,
		counts: { merged: number; failed: number; stopped: number },
	): string =>
		`${label}: ${counts.merged} merged, ${counts.failed} failed, ${counts.stopped} stopped`,
	stageDurations: "Stage durations",
	noStages: (days: number): string =>
		`No stage completed in the last ${days} days.`,
	allStages: (count: number): string => `Show all ${count} stages`,
	fewerStages: "Show fewer stages",
	stageRole: { agent: "agent", tool: "tool" },
	noCost: "-",
	queue: "Queue",
	noQueue: "No ticket waits.",
	held: (failures: number): string =>
		`held after ${plural(failures, "failure", "failures")}`,
	notServed: (factory: string, route: string): string =>
		`${factory} does not serve ${route}.`,
} as const;
