import type { RunGraph } from "./domain.ts";
import type { RunResult, RunStatusKind } from "./kinds.ts";
import type { PackageRun, StageUsage, StageVisit } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";

/** One workflow package at one version, from the started runs of the run history. */
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
	lastRunAt: string;
};

export type WorkflowsPage = { cards: WorkflowCard[] };

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

export type WorkflowDetail = {
	package: string;
	sha: string | null;
	stages: WorkflowStage[];
	runs: WorkflowRun[];
	/** The entry graph of the latest run that a factory serves the graph of. */
	graph: { runId: string; graph: RunGraph } | null;
};

const reviewerRole = "reviewer";

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

/** The nearest-rank percentile `share` of the values. */
function percentile(values: readonly number[], share: number): number | null {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? null;
}

function durationS(run: PackageRun): number | null {
	return run.endedAt === null
		? null
		: (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1_000;
}

/** One card for each package version, the version with the latest run first, and the runs with no sha last. */
export function workflowsPage(runs: readonly PackageRun[]): WorkflowsPage {
	const versions = Map.groupBy(runs, versionKey);
	return {
		cards: [...versions.values()]
			.flatMap((group) => {
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
							ended.length === 0
								? null
								: ended.filter((run) => run.result === "merged").length /
									ended.length,
						medianS: median(group.flatMap((run) => durationS(run) ?? [])),
						costPerRun: mean(group.flatMap((run) => run.costUsd ?? [])),
						lastRunAt: latest.startedAt,
					},
				];
			})
			// The runs with no known sha mix versions, so their card goes last.
			.toSorted((a, b) => Number(a.sha === null) - Number(b.sha === null)),
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

/** The detail of one package version: its stage statistics, its runs and the graph of its latest run. */
export function workflowDetail(input: {
	name: string;
	sha: string | null;
	runs: readonly PackageRun[];
	visits: readonly StageVisit[];
	usage: readonly StageUsage[];
	rows: readonly Pick<RunListRow, "id" | "pull">[];
	graph: WorkflowDetail["graph"];
}): WorkflowDetail {
	const pulls = new Map(
		input.rows.flatMap((row) =>
			row.pull === undefined ? [] : [[row.id, row.pull]],
		),
	);
	const reviewers = new Set(
		input.graph?.graph.nodes
			.filter((node) => node.role === reviewerRole)
			.map((node) => node.id),
	);
	const visitsOf = Map.groupBy(input.visits, (visit) => visit.runId);
	return {
		package: input.name,
		sha: input.sha,
		stages: stagesOf(input.visits, input.usage),
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
	};
}
