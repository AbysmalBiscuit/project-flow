import { z } from "zod";

import type { Factory } from "./configuration.ts";
import type { FactoryRun, RunStatusKind } from "./domain.ts";
import { body, type Read, Unreachable } from "./factory-http.ts";
import { liveRunStatusKinds } from "./kinds.ts";

export const runRow = z.object({
	id: z.string(),
	ticket: z.string(),
	repo: z.string().nullish(),
	status: z.object({
		kind: z.enum([
			"submitted",
			"starting",
			"running",
			"blocked",
			"succeeded",
			"failed",
		]),
		reason: z.string().nullish(),
	}),
	machine: z.string().nullish(),
	source: z.string().nullish(),
	rule: z.string().nullish(),
	queued_id: z.string().nullish(),
	submitted_at: z.string(),
	started_at: z.string().nullish(),
	ended_at: z.string().nullish(),
	restarted_from: z.string().nullish(),
	archived_at: z.string().nullish(),
	usage: z
		.object({
			tokens: z.object({ input: z.number(), output: z.number() }),
			cost_usd: z.number(),
			duration_s: z.number(),
		})
		.nullish(),
});

export const runRows = z.object({ runs: z.array(z.unknown()) });

const question = z.object({
	id: z.union([z.number(), z.string()]).transform(String),
	node_path: z.string().nullish(),
	text: z.string(),
});

/** The asks of a run. A factory that keeps no answered asks gives only the open ones. */
const runAsks = z.object({
	questions: z.array(question),
	answered: z
		.array(
			question.extend({
				answer: z.string(),
				sender: z.string().nullish(),
				answered_at: z.string(),
			}),
		)
		.default([]),
});

export type RunAsks = z.infer<typeof runAsks>;

export const localMachine = "local";

/** A run row of one factory. A local row comes from the box that does the run. */
export type ReadRun = {
	run: Omit<FactoryRun, "coveredByFeed" | "streamed" | "stage" | "pull">;
	local: boolean;
	url: string;
};

export type StatusRows<Row> = { hubRow: Row | undefined; row: Row | undefined };

export function isLive(kind: RunStatusKind): boolean {
	return liveRunStatusKinds.some((live) => live === kind);
}

export function statusKindOf(
	kind: z.infer<typeof runRow>["status"]["kind"],
): RunStatusKind {
	return kind === "submitted" ? "queued" : kind;
}

/** The runs of one `GET /runs` answer. A row that does not parse is left out. */
export function factoryRuns(rows: unknown[], factory: Factory): ReadRun[] {
	return rows.flatMap((row) => {
		const parsed = runRow.safeParse(row);
		if (!parsed.success) {
			return [];
		}
		const run = parsed.data;
		const machine = run.machine ?? null;
		const local = machine === localMachine;
		return [
			{
				run: {
					id: run.id,
					key: run.ticket,
					...(run.repo === null || run.repo === undefined
						? {}
						: { repo: run.repo }),
					statusKind: statusKindOf(run.status.kind),
					box: local ? factory.name : machine,
					factory: factory.name,
					...(run.source === null || run.source === undefined
						? {}
						: { source: run.source }),
					...(run.rule === null || run.rule === undefined
						? {}
						: { rule: run.rule }),
					...(run.queued_id === null || run.queued_id === undefined
						? {}
						: { queuedId: run.queued_id }),
					submittedAt: run.submitted_at,
					startedAt: run.started_at ?? null,
					endedAt: run.ended_at ?? null,
					...(run.restarted_from === null || run.restarted_from === undefined
						? {}
						: { restartedFrom: run.restarted_from }),
					...(run.archived_at === null || run.archived_at === undefined
						? {}
						: { archivedAt: run.archived_at }),
					...(run.status.reason === null ||
					run.status.reason === undefined ||
					run.status.reason === ""
						? {}
						: { failureReason: run.status.reason }),
					...(run.usage === null || run.usage === undefined
						? {}
						: {
								usageTotals: {
									inputTokens: run.usage.tokens.input,
									outputTokens: run.usage.tokens.output,
									costUsd: run.usage.cost_usd,
									durationS: run.usage.duration_s,
								},
							}),
				},
				local,
				url: factory.url,
			},
		];
	});
}

/**
 * The row that gives a run its status: the box row while its box is reachable,
 * or else the hub row. An unreachable box keeps its last row, which goes stale.
 */
export function statusRow<Row extends ReadRun>(
	same: Row[],
	reachable: (row: Row) => boolean,
): StatusRows<Row> {
	const hubRow = same.find((row) => !row.local);
	const boxRow = same.find((row) => row.local);
	const fresh =
		boxRow !== undefined && (hubRow === undefined || reachable(boxRow));
	return { hubRow, row: fresh ? boxRow : hubRow };
}

/**
 * One run per id. A hub and its box report the same id once the hub sends the run.
 * The status row gives the status, and the hub row gives `source`, `rule` and `queuedId`.
 */
export function mergedRuns(
	rows: (ReadRun & { coveredByFeed: boolean; streamed: boolean })[],
	stages: ReadonlyMap<string, string>,
) {
	return [...Map.groupBy(rows, (row) => row.run.id).values()].flatMap(
		(same): FactoryRun[] => {
			const { hubRow, row } = statusRow(same, (row) => row.coveredByFeed);
			if (row === undefined) {
				return [];
			}
			const { source, rule, queuedId, ...status } = row.run;
			const origin = hubRow?.run ?? row.run;
			const stage = stages.get(status.id);
			return [
				{
					...status,
					...(origin.source === undefined
						? {}
						: { source: origin.source, sourceFactory: origin.factory }),
					...(origin.rule === undefined ? {} : { rule: origin.rule }),
					...(origin.queuedId === undefined
						? {}
						: { queuedId: origin.queuedId }),
					coveredByFeed: row.coveredByFeed,
					streamed: same.some((row) => row.streamed),
					...(stage === undefined ? {} : { stage }),
				},
			];
		},
	);
}

/** The open and answered asks of a run. A factory that gives no list leaves them unknown. */
export async function asksOf(
	read: Read,
	id: string,
): Promise<RunAsks | undefined> {
	try {
		return await body(
			await read(`/runs/${encodeURIComponent(id)}/questions`),
			runAsks,
		);
	} catch (error) {
		if (!(error instanceof Unreachable)) {
			throw error;
		}
		return undefined;
	}
}
