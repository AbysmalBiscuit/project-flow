import { z } from "zod";

import { type RunResult, runResults } from "./kinds.ts";

const named = z.object({ name: z.string(), result: z.string() });

/** The record of one ended stage that verified something, as `GET /runs/{id}/verification` gives it. */
const stageRecord = z.object({
	node_path: z.string(),
	stage: z.string(),
	round: z.number(),
	verdicts: z
		.array(
			z.object({
				number: z.number(),
				text: z.string(),
				verdict: z.string(),
				reason: z.string(),
			}),
		)
		.nullable(),
	review_check: z
		.array(
			z.object({
				kind: z.string(),
				severity: z.string().nullable(),
				path: z.string().nullable(),
				line: z.number().nullable(),
				text: z.string(),
			}),
		)
		.nullable(),
	gate: z
		.object({ status: z.string(), label: z.string(), reason: z.string() })
		.nullable(),
	gate_checks: z
		.array(named.extend({ output: z.string().nullish() }))
		.nullable(),
	ci: z
		.object({
			head: z.string(),
			verdict: z.string(),
			line: z.string(),
			tasks: z.array(named),
			checks: z.array(named),
		})
		.nullable(),
});

/** The verification record of a run: each ended stage that verified something, in run order. */
export const verificationRecord = z.object({ stages: z.array(stageRecord) });

export type VerificationRecord = z.infer<typeof verificationRecord>;

/** A stored run result, or null for a value that is not one. */
export const storedResult = z.enum(runResults).nullable().catch(null);

type StageRecord = z.infer<typeof stageRecord>;

/** A run of the run history with its stored record. */
export type RecordedRun = {
	id: string;
	ticket: string;
	result: RunResult | null;
	endedAt: string | null;
	record: VerificationRecord;
};

export type ReviewLine = {
	/** `fixed` is a `FAIL` line that no later round of the run lists again. */
	state: "fail" | "kept" | "fixed";
	severity: string | null;
	path: string | null;
	line: number | null;
	text: string;
};

export type GateLine = {
	name: string;
	result: string;
	passed: boolean;
	detail: string | null;
};

export type VerificationRound = {
	round: number;
	/** The judged verdicts of the round: the last verdicts that a stage of the round gave. */
	doneWhen: NonNullable<StageRecord["verdicts"]>;
	/** The lines of the last review check of the round. */
	reviewCheck: ReviewLine[];
	/** The gate outcomes, the gate checks and the CI proofs of the round, in run order. */
	gates: GateLine[];
};

export type RunVerification = {
	id: string;
	ticket: string | null;
	result: RunResult | null;
	rounds: VerificationRound[];
	/** True when the factory of the run does not serve the verification route. */
	notServed: boolean;
};

export type CheckKind = "verifier" | "review" | "gate" | "gate check" | "ci";

const kindOrder: readonly CheckKind[] = [
	"verifier",
	"review",
	"gate",
	"gate check",
	"ci",
];

export type CheckRow = {
	name: string;
	kind: CheckKind;
	passed: number;
	total: number;
	/** The last results of the check, oldest first. */
	last: boolean[];
	topFailure: string | null;
};

export type VerificationPage = {
	tiles: {
		/** The judged verdicts of the first rounds. */
		firstRound: { verified: number; items: number };
		/** The rejected judged verdicts of each round. */
		rejected: { items: number; topReason: string | null };
		/** The `FAIL` lines of the last review check of each round, over the runs with records. */
		failLines: { lines: number; high: number; runs: number };
		/** The runs with a CI proof: the last proof passed, and the first proof passed. */
		ci: { passed: number; firstPush: number; runs: number };
	};
	checks: CheckRow[];
	reasons: { reason: string; items: number }[];
	/** The runs with a record that is not empty, newest first. */
	runs: Pick<RecordedRun, "id" | "ticket" | "result" | "endedAt">[];
	/** The factories whose last record read found no verification route. */
	notServed: string[];
};

/** The most results that a row of the checks table shows. */
const lastResults = 10;

const passedResult = "passed";

/**
 * Ticket references, paths and numbers: the words of a reason that name one ticket.
 * The punctuation that ends a sentence stays.
 */
const ticketWords = /\S*[#/\d]\S*?(?=[.,;:!?]*(?:\s|$))/g;

/** The reason text without its ticket-specific words, and the key that groups it. */
function reasonOf(raw: string): { text: string; key: string } {
	const text = raw
		.replace(ticketWords, "")
		.replace(/\s+/g, " ")
		.replace(/\s+([.,;:!?])/g, "$1")
		.trim();
	return { text, key: text.toLowerCase().replace(/[.,;:!?]+$/, "") };
}

const fullSha = /\b([0-9a-f]{7})[0-9a-f]{33}\b/g;

/** The failure text with each full sha cut to its first 7 characters, as the gates list shows a head. */
const failureText = (text: string): string => text.replace(fullSha, "$1");

/** The most common value, and the newest one of a tie. */
function mostCommon(values: readonly string[]): string | null {
	const counts = new Map<string, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	let best: string | null = null;
	let bestCount = 0;
	for (const [value, count] of counts) {
		if (count >= bestCount) {
			best = value;
			bestCount = count;
		}
	}
	return best;
}

function roundsOf(record: VerificationRecord): Map<number, StageRecord[]> {
	const rounds = new Map<number, StageRecord[]>();
	for (const stage of record.stages) {
		rounds.set(stage.round, [...(rounds.get(stage.round) ?? []), stage]);
	}
	return rounds;
}

function lastOf<T>(
	stages: readonly StageRecord[],
	part: (stage: StageRecord) => T | null,
): T | null {
	return stages.reduce<T | null>((found, stage) => part(stage) ?? found, null);
}

const lineKey = (line: { path: string | null; text: string }) =>
	JSON.stringify([line.path, line.text]);

function ciGate(ci: NonNullable<StageRecord["ci"]>): GateLine {
	const named = [...ci.tasks, ...ci.checks];
	return {
		name: `CI proof at ${ci.head.slice(0, 7)}`,
		result: ci.verdict,
		passed: ci.verdict === passedResult,
		detail: `${named.filter((check) => check.result === passedResult).length} of ${named.length} checks`,
	};
}

/** The record of one run, one item for each round. */
export function verificationRounds(
	record: VerificationRecord,
): VerificationRound[] {
	const rounds = [...roundsOf(record)];
	const reviews = rounds.map(([, stages]) =>
		lastOf(stages, (stage) => stage.review_check),
	);
	return rounds.map(([round, stages], index) => {
		const later = new Set(
			reviews
				.slice(index + 1)
				.flatMap((lines) => lines ?? [])
				.filter((line) => line.kind === "FAIL")
				.map(lineKey),
		);
		const isLast = index === rounds.length - 1;
		return {
			round,
			doneWhen: lastOf(stages, (stage) => stage.verdicts) ?? [],
			reviewCheck: (reviews[index] ?? []).map((line) => ({
				state:
					line.kind === "KEPT"
						? "kept"
						: isLast || later.has(lineKey(line))
							? "fail"
							: "fixed",
				severity: line.severity,
				path: line.path,
				line: line.line,
				text: line.text,
			})),
			gates: stages.flatMap((stage): GateLine[] => [
				...(stage.gate_checks ?? []).map((check) => ({
					name: check.name,
					result: check.result,
					passed: check.result === passedResult,
					detail: null,
				})),
				...(stage.gate === null
					? []
					: [
							{
								name: stage.node_path,
								result: stage.gate.status,
								passed: stage.gate.status === "success",
								detail: stage.gate.label || stage.gate.reason || null,
							},
						]),
				...(stage.ci === null ? [] : [ciGate(stage.ci)]),
			]),
		};
	});
}

type CheckResult = {
	name: string;
	kind: CheckKind;
	passed: boolean;
	failure: string | null;
};

/** The result of each check that one stage ran. A round's first verdicts are its verifier's. */
function stageResults(
	stage: StageRecord,
	verifierStage: boolean,
): CheckResult[] {
	const results: CheckResult[] = [];
	if (verifierStage && stage.verdicts !== null) {
		const failed = stage.verdicts.find(
			(item) => item.verdict === "rejected" || item.verdict === "error",
		);
		results.push({
			name: "Done-when verdicts",
			kind: "verifier",
			passed: failed === undefined,
			failure: failed === undefined ? null : reasonOf(failed.reason).text,
		});
	}
	if (stage.review_check !== null) {
		const failed = stage.review_check.find((line) => line.kind === "FAIL");
		results.push({
			name: "Review check",
			kind: "review",
			passed: failed === undefined,
			failure: failed?.text ?? null,
		});
	}
	if (stage.gate !== null) {
		const passed = stage.gate.status === "success";
		results.push({
			name: stage.node_path,
			kind: "gate",
			passed,
			failure: passed ? null : stage.gate.reason || stage.gate.label,
		});
	}
	for (const check of stage.gate_checks ?? []) {
		const passed = check.result === passedResult;
		results.push({
			name: check.name,
			kind: "gate check",
			passed,
			failure: passed ? null : check.output || check.result,
		});
	}
	if (stage.ci !== null) {
		const passed = stage.ci.verdict === passedResult;
		results.push({
			name: "CI proof",
			kind: "ci",
			passed,
			failure: passed ? null : stage.ci.line || stage.ci.verdict,
		});
		for (const task of [...stage.ci.tasks, ...stage.ci.checks]) {
			const done = task.result === passedResult;
			results.push({
				name: task.name,
				kind: "ci",
				passed: done,
				failure: done ? null : task.result,
			});
		}
	}
	return results;
}

function checkRows(runs: readonly RecordedRun[]): CheckRow[] {
	const groups = new Map<string, CheckResult[]>();
	for (const run of runs) {
		const verified = new Set<number>();
		for (const stage of run.record.stages) {
			const first = stage.verdicts !== null && !verified.has(stage.round);
			if (first) {
				verified.add(stage.round);
			}
			for (const result of stageResults(stage, first)) {
				const key = JSON.stringify([result.kind, result.name]);
				groups.set(key, [...(groups.get(key) ?? []), result]);
			}
		}
	}
	return [...groups.values()]
		.flatMap(([first, ...rest]) =>
			first === undefined ? [] : [{ first, results: [first, ...rest] }],
		)
		.map(({ first, results }) => ({
			name: first.name,
			kind: first.kind,
			passed: results.filter((result) => result.passed).length,
			total: results.length,
			last: results.slice(-lastResults).map((result) => result.passed),
			topFailure: mostCommon(
				results.flatMap((result) =>
					result.failure === null ? [] : [failureText(result.failure)],
				),
			),
		}))
		.sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));
}

/**
 * The Verification tab across runs. `runs` holds the stored records, oldest first.
 * `notServed` names the factories with no verification route.
 */
export function verificationPage(
	runs: readonly RecordedRun[],
	notServed: string[],
): VerificationPage {
	const recorded = runs.filter((run) => run.record.stages.length > 0);
	let firstVerified = 0;
	let firstItems = 0;
	let failLines = 0;
	let highLines = 0;
	let ciRuns = 0;
	let ciPassed = 0;
	let ciFirst = 0;
	const reasons = new Map<string, { text: string; items: number }>();
	for (const run of recorded) {
		for (const round of verificationRounds(run.record)) {
			if (round.round === 1) {
				firstItems += round.doneWhen.length;
				firstVerified += round.doneWhen.filter(
					(item) => item.verdict === "verified",
				).length;
			}
			for (const item of round.doneWhen) {
				if (item.verdict !== "rejected") {
					continue;
				}
				const reason = reasonOf(item.reason);
				const group = reasons.get(reason.key) ?? {
					text: reason.text,
					items: 0,
				};
				reasons.set(reason.key, { ...group, items: group.items + 1 });
			}
			const fails = round.reviewCheck.filter((line) => line.state !== "kept");
			failLines += fails.length;
			highLines += fails.filter((line) => line.severity === "high").length;
		}
		const proofs = run.record.stages.flatMap((stage) =>
			stage.ci === null ? [] : [stage.ci.verdict === passedResult],
		);
		if (proofs.length > 0) {
			ciRuns += 1;
			ciPassed += proofs.at(-1) === true ? 1 : 0;
			ciFirst += proofs[0] === true ? 1 : 0;
		}
	}
	const reasonRows = [...reasons.values()]
		.map((group) => ({ reason: group.text, items: group.items }))
		.sort((a, b) => b.items - a.items);
	return {
		tiles: {
			firstRound: { verified: firstVerified, items: firstItems },
			rejected: {
				items: reasonRows.reduce((sum, row) => sum + row.items, 0),
				topReason: reasonRows[0]?.reason ?? null,
			},
			failLines: { lines: failLines, high: highLines, runs: recorded.length },
			ci: { passed: ciPassed, firstPush: ciFirst, runs: ciRuns },
		},
		checks: checkRows(recorded),
		reasons: reasonRows,
		runs: recorded
			.map(({ id, ticket, result, endedAt }) => ({
				id,
				ticket,
				result,
				endedAt,
			}))
			.reverse(),
		notServed,
	};
}
