import { z } from "zod";

import type { RunResult } from "./kinds.ts";

/** The levels of a retro's smoothness, from the best to the worst. */
export const smoothnessLevels = [
	"smooth",
	"bumpy",
	"rough",
	"stalled",
	"failed",
] as const;

export type Smoothness = (typeof smoothnessLevels)[number];

export const smoothness = z.enum(smoothnessLevels);

/** The derived retro of an ended run, as `GET /runs/{id}/retro` gives it. */
export const retroRecord = z.object({
	facts: z.object({
		outcome: z.string(),
		failure: z.string().nullable(),
		duration_s: z.number(),
		cost_usd: z.number(),
		rounds: z.object({ review: z.number(), pr: z.number() }),
		stages: z.record(
			z.string(),
			z.object({ visits: z.number(), retries: z.number() }),
		),
		resumes: z.number(),
		restarts: z.number(),
	}),
	friction: z.array(
		z.object({
			kind: z.string(),
			stage: z.string(),
			time_s: z.number(),
			at: z.string(),
			detail: z.string(),
		}),
	),
	time_lost_s: z.number(),
	smoothness,
});

export type RetroRecord = z.infer<typeof retroRecord>;

/** A run of the run history with its stored retro. */
export type RetroRun = {
	id: string;
	ticket: string;
	result: RunResult | null;
	endedAt: string | null;
	retro: RetroRecord;
};

/** The time that each stage took, from the stage rows of the run history. */
export type StageTime = { stage: string; seconds: number };

export type RetroRow = Omit<RetroRun, "retro"> & {
	smoothness: Smoothness;
	durationS: number;
	/** The larger of the review rounds and the PR rounds, as the smoothness rule counts them. */
	rounds: number;
	/** The count of friction points. */
	friction: number;
	timeLostS: number;
	costUsd: number;
};

/** The friction points of one kind and cause, and the count of runs that hit them. */
export type FrictionGroup = { kind: string; cause: string; runs: number };

export type RetrosPage = {
	/** The runs with a retro, newest first. */
	runs: RetroRow[];
	friction: FrictionGroup[];
	/** The factories whose last retro read found no retro route. */
	notServed: string[];
};

export type FrictionPoint = {
	kind: string;
	stage: string;
	timeS: number;
	at: string;
	detail: string;
};

export type RetroStage = {
	stage: string;
	seconds: number;
	visits: number;
	retries: number;
	/** The time cost of the friction points of the stage. */
	lostS: number;
};

export type RetroDetail = {
	smoothness: Smoothness;
	outcome: string;
	failure: string | null;
	durationS: number;
	costUsd: number;
	rounds: number;
	/** The retries of all stages. */
	retries: number;
	timeLostS: number;
	/** The stages in the order of their first stage row, then the stages with no row. */
	stages: RetroStage[];
	friction: FrictionPoint[];
};

export type RunRetro = {
	id: string;
	ticket: string | null;
	result: RunResult | null;
	retro: RetroDetail | null;
	/** True when the factory of the run does not serve the retro route. */
	notServed: boolean;
};

const roundsOf = (retro: RetroRecord): number =>
	Math.max(retro.facts.rounds.review, retro.facts.rounds.pr);

/** True when `level` is `atLeast` or worse. */
export const worseOrSame = (level: Smoothness, atLeast: Smoothness): boolean =>
	smoothnessLevels.indexOf(level) >= smoothnessLevels.indexOf(atLeast);

/**
 * What a friction point blames: its detail, else its stage, else the run.
 * A question has no detail, so its stage names it.
 */
const causeOf = (point: RetroRecord["friction"][number]): string =>
	point.detail.trim() || point.stage || "run";

/**
 * The Retros tab across runs. `runs` holds the stored retros, oldest first.
 * The friction groups count each run once, and show the newest text of a cause.
 */
export function retrosPage(
	runs: readonly RetroRun[],
	notServed: string[],
	atLeast: Smoothness | null,
): RetrosPage {
	const groups = new Map<
		string,
		{ kind: string; cause: string; runs: Set<string>; lostS: number }
	>();
	for (const run of runs) {
		for (const point of run.retro.friction) {
			const cause = causeOf(point);
			const key = JSON.stringify([point.kind, cause.toLowerCase()]);
			const group = groups.get(key) ?? {
				kind: point.kind,
				cause,
				runs: new Set<string>(),
				lostS: 0,
			};
			group.cause = cause;
			group.runs.add(run.id);
			group.lostS += point.time_s;
			groups.set(key, group);
		}
	}
	return {
		runs: runs
			.filter(
				(run) => atLeast === null || worseOrSame(run.retro.smoothness, atLeast),
			)
			.map(({ retro, ...run }) => ({
				...run,
				smoothness: retro.smoothness,
				durationS: retro.facts.duration_s,
				rounds: roundsOf(retro),
				friction: retro.friction.length,
				timeLostS: retro.time_lost_s,
				costUsd: retro.facts.cost_usd,
			}))
			.reverse(),
		friction: [...groups.values()]
			.sort((a, b) => b.runs.size - a.runs.size || b.lostS - a.lostS)
			.map((group) => ({
				kind: group.kind,
				cause: group.cause,
				runs: group.runs.size,
			})),
		notServed,
	};
}

/** The retro of one run, with the time of each stage from the run history. */
export function retroDetail(
	retro: RetroRecord,
	times: readonly StageTime[],
): RetroDetail {
	const seconds = new Map(times.map((time) => [time.stage, time.seconds]));
	const order = [
		...new Set([
			...times.map((time) => time.stage),
			...Object.keys(retro.facts.stages),
		]),
	];
	const lost = new Map<string, number>();
	for (const point of retro.friction) {
		lost.set(point.stage, (lost.get(point.stage) ?? 0) + point.time_s);
	}
	const stages = order.map((stage) => ({
		stage,
		seconds: seconds.get(stage) ?? 0,
		visits: retro.facts.stages[stage]?.visits ?? 0,
		retries: retro.facts.stages[stage]?.retries ?? 0,
		lostS: lost.get(stage) ?? 0,
	}));
	return {
		smoothness: retro.smoothness,
		outcome: retro.facts.outcome,
		failure: retro.facts.failure,
		durationS: retro.facts.duration_s,
		costUsd: retro.facts.cost_usd,
		rounds: roundsOf(retro),
		retries: stages.reduce((sum, stage) => sum + stage.retries, 0),
		timeLostS: retro.time_lost_s,
		stages,
		friction: retro.friction.map((point) => ({
			kind: point.kind,
			stage: point.stage,
			timeS: point.time_s,
			at: point.at,
			detail: point.detail,
		})),
	};
}
