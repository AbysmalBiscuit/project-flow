import { plural, spanText } from "./factories-terms.ts";
import { compactCount, costLabel } from "./run-terms.ts";

/** The workcell ticket that adds the package list and the graphs of packages without a run. */
const packageRoutesTicket = 1781;

export const workflowsCopy = {
	subtitle:
		"The workflow packages each factory runs, their graphs, and how their stages perform.",
	empty: "No run of a workflow package is in the run history yet.",
	noSha: "no sha",
	showOlder: (count: number): string =>
		`Show ${plural(count, "older version", "older versions")}`,
	hideOlder: "Hide older versions",
	sha: (sha: string): string => `sha ${sha}`,
	/** The start of the first run of a version, as `yyyy-mm-dd hh:mm` in local time. */
	since: (iso: string): string => {
		const at = new Date(iso);
		const two = (value: number) => String(value).padStart(2, "0");
		return `since ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
	},
	tokens: (count: number): string => compactCount.format(Math.round(count)),
	share: (share: number): string => `${Math.round(share * 100)}%`,
	visits: (perRun: number): string => perRun.toFixed(1),
	lastRun: (span: string): string => `last run ${span} ago`,
	noRunYet: "no run yet",
	stats: {
		runs: "runs",
		merged: "merged",
		mergedReading: "merged, reading runs",
		median: "median",
		perRun: "per run",
	},
	source: "project-flow",
	packageRoute: "GET /packages/{name}",
	needsPackages: `needs workcell#${packageRoutesTicket} for graphs without a run`,
	tabs: { diagram: "Diagram", stages: "Stages", roles: "Roles", runs: "Runs" },
	tabsLabel: "Package detail",
	diagramNote: (fromRun: boolean): string =>
		`Border colour = role. Edge label = condition. ${fromRun ? "The graphs of the latest run." : "The graphs that the factory serves."}`,
	noRoles: "The package names no role.",
	noGraph: "No factory serves the workflow files of a run of this version.",
	mainFlow: "Main flow",
	calledBy: (stage: string, more: number): string =>
		`called by ${stage}${more > 0 ? ` +${more}` : ""}`,
	noCaller: "no stage calls it",
	graphsLabel: "Graphs, in call order",
	noStages: "No run of this version has stage rows yet.",
	allStages: (count: number): string => `Show all ${count} stages`,
	fewerStages: "Show fewer stages",
	noRuns: "No run of this version.",
	search: "Search package or sha",
	allPackages: "All packages",
	runsFilter: { any: "Any runs", with: "Has runs", none: "No run yet" },
	latestOnly: "Latest version only",
	latest: "latest",
	noMatch: "No version matches.",
	clearFilters: "Clear filters",
	backToTable: "Back to table",
	closeDetail: "Close the detail",
	versions: "Package versions",
	columns: {
		package: "Package",
		version: "Version",
		since: "Since",
		lastRun: "Last run",
		runs: "Runs",
		merged: "Merged",
		median: "Median",
		perRun: "Per run",
		stage: "Stage",
		visits: "Visits / run",
		failRate: "Fail rate",
		p50: "p50",
		p95: "p95",
		tokens: "Tokens / run",
		cost: "Cost / run",
		result: "Result",
		ticket: "Ticket",
		factory: "Factory",
		duration: "Duration",
		rounds: "Rounds",
		pr: "PR",
		runCost: "Cost",
		role: "Role",
		harness: "Harness",
		model: "Model",
		stages: "Stages",
		costShare: "Cost share",
	},
	none: "-",
	/** A time in seconds as a span, or a dash. */
	seconds: (value: number | null): string =>
		value === null ? "-" : spanText(value * 1_000),
	/** A cost in USD, or a dash. */
	cost: (value: number | null): string =>
		value === null ? "-" : costLabel(value),
	pane: {
		label: "Stage detail",
		close: "Close the stage detail",
		kind: "Kind",
		role: "Role",
		harness: "Harness",
		model: "Model",
		noRole: "no role",
		calls: "Calls",
		stats: "Per run of this version",
		noStats: "No run of this version visited the stage.",
		from: "Comes from",
		to: "Goes to",
		noEdge: "No edge.",
	},
} as const;

/** The percentage of `part` in `whole`, rounded, or a dash when `whole` is 0. */
const percent = (part: number, whole: number): string =>
	whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;

const perRun = (count: number, runs: number): string =>
	runs === 0 ? "-" : (count / runs).toFixed(1);

export const verificationCopy = {
	subtitle:
		"What each run proved before merge: the Done-when verdicts, the review check, the gates and CI.",
	percent,
	perRun,
	tiles: {
		firstRound: "Verified in round 1",
		rejected: "Rejected verdicts",
		failLines: "Review FAIL lines / run",
		ci: "CI proof passed",
	},
	firstRoundDetail: (items: number): string =>
		`last 30 days, ${plural(items, "Done-when verdict", "Done-when verdicts")}`,
	mostOften: (reason: string | null): string =>
		reason === null ? "no rejected verdict" : `most often: ${reason}`,
	highSeverity: (value: string): string => `high severity ${value}`,
	firstPush: (value: string): string => `first push ${value}`,
	checks: "Checks",
	reasons: "Rejection reasons",
	noChecks: "No stored record has a check yet.",
	noReasons: "No verdict rejects a Done-when line.",
	columns: {
		check: "Check",
		kind: "Kind",
		passRate: "Pass rate",
		last: "Last 10 results",
		topFailure: "Top failure",
		reason: "Reason",
		items: "Rejected verdicts",
		result: "Result",
		rounds: "Rounds",
		ended: "Ended",
	},
	noFailure: "-",
	sources: {
		aggregate: "project-flow aggregate",
		store: "project-flow",
		route: "GET /runs/{id}/verification",
	},
	run: "Run",
	pickRun: "Run",
	noRuns: "No ended run has a verification record yet.",
	round: (round: number, last: boolean): string =>
		round === 0 ? "Before round 1" : `Round ${round}${last ? " (final)" : ""}`,
	doneWhen: "Done when",
	reviewCheck: "Review check",
	gates: "Gates and CI",
	noDoneWhen: "The round gave no Done-when verdict.",
	noReviewCheck: "The round has no review check line.",
	noGates: "The round ran no gate and no CI proof.",
	noRecord: "The factory has no verification record of this run yet.",
	reviewState: { fail: "FAIL", kept: "KEPT", fixed: "FIXED" },
	where: (path: string | null, line: number | null): string =>
		path === null ? "" : line === null ? path : `${path}:${line}`,
	notServed: (factory: string): string =>
		`${factory} does not serve GET /runs/{id}/verification.`,
	runNotServed:
		"The factory of this run does not serve GET /runs/{id}/verification.",
	searchCheck: "Search check or failure",
	searchReason: "Search reason",
	searchTicket: "Search ticket",
	failingOnly: "Failing only",
	noCheckMatch: "No check matches.",
	noReasonMatch: "No reason matches.",
	runs: "Runs",
} as const;

const frictionKindText: Partial<Record<string, string>> = {
	retry: "The stage ran again.",
	over_cap: "A decision went over its cap.",
	stopped: "An attempt stopped.",
	question: "The run waited on an answer.",
	steer: "A steer reached the worker.",
	restart: "The run took a loop restart.",
	resume: "The run resumed.",
	failure: "The run failed.",
};

/** The workcell ticket for the intent, outcome, learnings and open items of a retro. */
const retroNotesTicket = 1784;

export const retrosCopy = {
	subtitle: "How each ended run went, and where it lost time.",
	runs: "Runs",
	all: "All",
	roughOrWorse: "Rough or worse",
	friction: "Friction across runs",
	sources: {
		route: "GET /runs/{id}/retro",
		aggregate: "project-flow aggregate",
	},
	columns: {
		ticket: "Ticket",
		smoothness: "Smoothness",
		duration: "Duration",
		rounds: "Rounds",
		friction: "Friction",
		lost: "Lost",
		cost: "Cost",
		stage: "Stage",
		minutes: "Minutes",
		retries: "Retries",
		kind: "Kind",
		cause: "Cause",
		runs: "Runs",
	},
	tiles: {
		duration: "Duration",
		cost: "Cost",
		rounds: "Rounds",
		retries: "Retries",
		lost: "Time lost",
	},
	stages: "Stages",
	frictionPoints: "Friction",
	notes: {
		intent: "Intent",
		outcome: "Outcome",
		learnings: "Learnings",
		openItems: "Open items",
	},
	notesSource: `needs workcell#${retroNotesTicket}`,
	noNote: "The retro route does not give this yet.",
	runCount: (runs: number): string => plural(runs, "run", "runs"),
	/** A friction point with no detail says what happened by its kind. */
	kindText: (kind: string): string =>
		frictionKindText[kind] ?? kind.replaceAll("_", " "),
	where: (stage: string, lost: string | null): string =>
		[stage, lost].filter((part) => part !== null && part !== "").join(", "),
	noRuns: "No ended run has a retro yet.",
	noRough: "No run went rough or worse.",
	noFriction: "No run lost time to friction.",
	noStages: "The run has no stage.",
	noPoints: "The run had no friction point.",
	noRetro: "The factory has no retro of this run yet.",
	runNotServed: "The factory of this run does not serve GET /runs/{id}/retro.",
	searchTicket: "Search ticket",
	summary: {
		runs: "Runs",
		smooth: "Smooth",
		median: "Median duration",
		lost: "Time lost",
		cost: "Cost",
	},
	summaryNote: {
		all: "with a retro",
		filtered: "in the current filter",
		smooth: (count: number, of: number): string => `${count} of ${of}`,
		median: "per run",
		lost: "sum of friction",
		cost: (perRun: string): string => `${perRun} per run`,
	},
	frictionHint:
		"Each cause counts a run once. Expand a cause to see the runs that hit it.",
	hitRuns: (count: number): string =>
		`${plural(count, "run", "runs")} hit this cause. Pick one to open its retro.`,
	filterRuns: (count: number): string =>
		`Filter the Runs tab to these ${plural(count, "run", "runs")}`,
	hitBy: (cause: string): string => `Runs that hit: ${cause}`,
	clearFilter: "Clear",
	lostTime: (span: string): string => `lost ${span}`,
	noMatch: "No run matches.",
	pickRun: "Pick a run to see its retro.",
	outsideFilter: "Outside the current filter",
} as const;
