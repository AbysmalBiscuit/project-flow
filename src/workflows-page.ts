import type { FactoryPackage, PackageDetail } from "./factory-packages.ts";
import type { RunResult, RunStatusKind } from "./kinds.ts";
import type {
	ModelUsage,
	PackageRun,
	StageUsage,
	StageVisit,
} from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";
import { percentile } from "./stats.ts";
import type { WorkflowGraph } from "./workflow-dot.ts";

/** One workflow package at one version, from the started runs of the run history or from a factory that lists it. */
export type WorkflowCard = {
	package: string;
	/** Null for runs whose `workflow.started` event the run history does not hold. */
	sha: string | null;
	runs: number;
	/** The share of the ended runs that merged. Null before a run ends. */
	mergeRate: number | null;
	/** The median wall time of the ended runs, in seconds. */
	medianS: number | null;
	costPerRun: number | null;
	/** Null for a package with no started run. */
	lastRunAt: string | null;
};

export type WorkflowsPage = {
	cards: WorkflowCard[];
	/** True while the first PR reads after a start run, so each merge rate is null. */
	reading: boolean;
};

export type WorkflowStage = {
	stage: string;
	visitsPerRun: number;
	/** The share of the visits that ended in `stage.failed`. */
	failRate: number;
	p50S: number | null;
	p95S: number | null;
	/** Null when no turn of the version ran in the stage. */
	tokensPerRun: number | null;
	costPerRun: number | null;
};

export type WorkflowRun = {
	id: string;
	key: string;
	status: RunStatusKind;
	result?: RunResult;
	factory: string;
	durationS: number | null;
	/** The visits of the reviewer stages. Null without the graph or the stage rows of the run. */
	rounds: number | null;
	pull?: { number: number; url: string };
	costUsd: number | null;
};

/** A role of a package version: what runs it, its stages and its share of the turn cost. */
export type WorkflowRole = {
	role: string;
	/** The harnesses of the turns of the role, the costliest first, else the harness of the package stylesheet. */
	harnesses: string[];
	/** The models of the turns of the role, the costliest first, else the model of the package stylesheet. */
	models: string[];
	/** The nodes of the role, in the order of the graphs. */
	stages: string[];
	/** The share of the turn cost of the runs. Null when no run of the version has turns. */
	costShare: number | null;
};

export type WorkflowDetail = {
	package: string;
	sha: string | null;
	/** The top-level stages only. A stage of a child graph is not in the list. */
	stages: WorkflowStage[];
	runs: WorkflowRun[];
	/**
	 * The graphs of the package version: the entry graph first, then each graph it calls.
	 * They come from the factory that lists the version, else from the latest run that `runId` names.
	 */
	graph: { runId?: string; graphs: WorkflowGraph[] } | null;
	/** Null when no factory lists the package version. */
	roles: WorkflowRole[] | null;
};

const reviewerRole = "reviewer";
/** The mark in the path of a stage that a child graph runs, such as `post_pr/merge`. */
const childStageMark = "/";

const versionKey = (run: Pick<PackageRun, "package" | "sha">) =>
	JSON.stringify([run.package, run.sha]);

const sum = (values: readonly number[]) =>
	values.reduce((total, value) => total + value, 0);

const mean = (values: readonly number[]) =>
	values.length === 0 ? null : sum(values) / values.length;

function median(values: readonly number[]): number | null {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const high = sorted[middle];
	if (high === undefined) {
		return null;
	}
	const low = sorted[middle - 1];
	return sorted.length % 2 === 0 && low !== undefined ? (low + high) / 2 : high;
}

function durationS(run: PackageRun): number | null {
	return run.endedAt === null
		? null
		: (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1_000;
}

/**
 * One card for each package version, the version with the latest run first.
 * The listed package versions with no run follow, and the runs with no sha go last.
 */
export function workflowsPage(
	runs: readonly PackageRun[],
	reading: boolean,
	listed: readonly FactoryPackage[],
): WorkflowsPage {
	const versions = Map.groupBy(runs, versionKey);
	const unrun = listed
		.filter(
			(item) =>
				!versions.has(versionKey({ package: item.name, sha: item.version })),
		)
		.map((item): WorkflowCard => ({
			package: item.name,
			sha: item.version,
			runs: 0,
			mergeRate: null,
			medianS: null,
			costPerRun: null,
			lastRunAt: item.lastRun,
		}));
	const cards = [...versions.values()].flatMap((group) => {
		const [latest] = group;
		if (latest === undefined) {
			return [];
		}
		const ended = group.filter((run) => run.result !== null);
		return [
			{
				package: latest.package,
				sha: latest.sha,
				runs: group.length,
				mergeRate:
					reading || ended.length === 0
						? null
						: ended.filter((run) => run.result === "merged").length /
							ended.length,
				medianS: median(group.flatMap((run) => durationS(run) ?? [])),
				costPerRun: mean(group.flatMap((run) => run.costUsd ?? [])),
				lastRunAt: latest.startedAt,
			},
		];
	});
	return {
		reading,
		// The runs with no known sha mix versions, so their card goes last.
		cards: [
			...cards.filter((card) => card.sha !== null),
			...unrun,
			...cards.filter((card) => card.sha === null),
		],
	};
}

/** The runs of one package version, newest first. */
export function versionRuns(
	runs: readonly PackageRun[],
	name: string,
	sha: string | null,
): PackageRun[] {
	const key = versionKey({ package: name, sha });
	return runs.filter((run) => versionKey(run) === key);
}

/**
 * The statistics of each stage, in the order that the runs first visit them.
 * Each share is over the runs that have stage rows, or turn rows for the usage.
 */
function stagesOf(
	visits: readonly StageVisit[],
	usage: readonly StageUsage[],
): WorkflowStage[] {
	const visitedRuns = new Set(visits.map((visit) => visit.runId)).size;
	const usedRuns = new Set(usage.map((row) => row.runId)).size;
	const ranks = new Map<string, number[]>();
	for (const runVisits of Map.groupBy(
		visits,
		(visit) => visit.runId,
	).values()) {
		[...new Set(runVisits.map((visit) => visit.stage))].forEach(
			(stage, rank) => {
				ranks.set(stage, [...(ranks.get(stage) ?? []), rank]);
			},
		);
	}
	const usageOf = Map.groupBy(usage, (row) => row.stage);
	return [...Map.groupBy(visits, (visit) => visit.stage)]
		.map(([stage, rows]) => {
			const durations = rows.flatMap((row) => row.durationS ?? []);
			const used = usageOf.get(stage);
			return {
				rank: mean(ranks.get(stage) ?? []) ?? 0,
				stage: {
					stage,
					visitsPerRun: rows.length / visitedRuns,
					failRate:
						rows.filter((row) => row.event === "stage.failed").length /
						rows.length,
					p50S: percentile(durations, 0.5),
					p95S: percentile(durations, 0.95),
					tokensPerRun:
						used === undefined
							? null
							: sum(used.map((row) => row.tokens)) / usedRuns,
					costPerRun:
						used === undefined
							? null
							: sum(used.map((row) => row.costUsd)) / usedRuns,
				},
			};
		})
		.toSorted(
			(a, b) => a.rank - b.rank || a.stage.stage.localeCompare(b.stage.stage),
		)
		.map((item) => item.stage);
}

/** The keys that `pick` gives, the costliest first. */
function byCost(
	rows: readonly ModelUsage[],
	pick: (row: ModelUsage) => string | null,
): string[] {
	const costs = new Map<string, number>();
	for (const row of rows) {
		const key = pick(row);
		if (key !== null) {
			costs.set(key, (costs.get(key) ?? 0) + row.costUsd);
		}
	}
	return [...costs].toSorted((a, b) => b[1] - a[1]).map(([key]) => key);
}

/**
 * Each role of the package. A turn belongs to the role of the node at the end of its node path.
 * A node id that two graphs share takes its role from the first graph.
 */
function rolesOf(
	listed: PackageDetail,
	usage: readonly ModelUsage[],
): WorkflowRole[] {
	const nodes = listed.graphs.flatMap((item) => item.graph.nodes);
	const roleOf = new Map<string, string>();
	for (const node of nodes) {
		if (node.role !== undefined && !roleOf.has(node.id)) {
			roleOf.set(node.id, node.role);
		}
	}
	const total = sum(usage.map((row) => row.costUsd));
	const usageOf = Map.groupBy(usage, (row) =>
		roleOf.get(row.stage.split(childStageMark).at(-1) ?? row.stage),
	);
	return listed.roles.map((role) => {
		const rows = usageOf.get(role.name) ?? [];
		const harnesses = byCost(rows, (row) => row.harness);
		const models = byCost(rows, (row) => row.model);
		return {
			role: role.name,
			harnesses:
				harnesses.length > 0 || role.harness === null
					? harnesses
					: [role.harness],
			models: models.length > 0 || role.model === null ? models : [role.model],
			stages: [
				...new Set(
					nodes
						.filter((node) => node.role === role.name)
						.map((node) => node.id),
				),
			],
			costShare:
				usage.length === 0
					? null
					: total === 0
						? 0
						: sum(rows.map((row) => row.costUsd)) / total,
		};
	});
}

/** The detail of one package version: its stage statistics, its runs, its graphs and its roles. */
export function workflowDetail(input: {
	name: string;
	sha: string | null;
	runs: readonly PackageRun[];
	visits: readonly StageVisit[];
	usage: readonly StageUsage[];
	rows: readonly Pick<RunListRow, "id" | "pull">[];
	graph: WorkflowDetail["graph"];
	/** The package that a factory lists at this version, and the turn cost of each stage by harness and model. */
	listed: { detail: PackageDetail; usage: readonly ModelUsage[] } | null;
}): WorkflowDetail {
	const pulls = new Map(
		input.rows.flatMap((row) =>
			row.pull === undefined ? [] : [[row.id, row.pull]],
		),
	);
	const reviewers = new Set(
		input.graph?.graphs[0]?.graph.nodes
			.filter((node) => node.role === reviewerRole)
			.map((node) => node.id),
	);
	const visitsOf = Map.groupBy(input.visits, (visit) => visit.runId);
	return {
		package: input.name,
		sha: input.sha,
		stages: stagesOf(input.visits, input.usage).filter(
			(stage) => !stage.stage.includes(childStageMark),
		),
		runs: input.runs.map((run) => {
			const pull = pulls.get(run.id);
			const visited = visitsOf.get(run.id);
			return {
				id: run.id,
				key: run.key,
				status: run.status,
				...(run.result === null ? {} : { result: run.result }),
				factory: run.factory,
				durationS: durationS(run),
				rounds:
					input.graph === null || visited === undefined
						? null
						: visited.filter((visit) => reviewers.has(visit.stage)).length,
				...(pull === undefined
					? {}
					: { pull: { number: pull.number, url: pull.url } }),
				costUsd: run.costUsd,
			};
		}),
		graph: input.graph,
		roles:
			input.listed === null
				? null
				: rolesOf(input.listed.detail, input.listed.usage),
	};
}
