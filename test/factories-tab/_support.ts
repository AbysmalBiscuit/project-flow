import type { FactoriesPage } from "../../src/factories-page.ts";
import daemonSlots from "../fixtures/factory-daemon-slots.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hubUrl,
	laptopUrl,
	serve,
} from "../support/factory.ts";

export const clockStart = "2026-10-25T14:20:00.000Z";

const [running41] = hubRuns.runs;
if (running41 === undefined) {
	throw new Error("the hub runs fixture lost a run");
}

/** A hub run row: the run of ticket 41 with the fields that `overrides` sets. */
export function hubRun(overrides: Record<string, unknown>) {
	return { ...running41, ...overrides };
}

export function usage(costUsd: number) {
	return {
		tokens: { input: 1_000, output: 100 },
		cost_usd: costUsd,
		duration_s: 600,
	};
}

export const hubAbout = daemonSlots;

export const laptopAbout = {
	...daemonSlots,
	role: "daemon",
	max_runs: 2,
	daemon_id: "1a2b3c4d5e6f7a8b",
	slots: { total: 2, used: 1 },
};

/**
 * The app with the hub and, when given, the laptop daemon. The clock stays at
 * `clockStart` unless `now` replaces it.
 */
export async function serveFactories(
	hubAnswers: Answers,
	laptopAnswers?: Answers | "down",
	now: () => Date = () => new Date(clockStart),
) {
	const requests: FactoryRequest[] = [];
	const app = await serve(
		[],
		{
			factories: [
				{ name: "work hub", url: hubUrl },
				...(laptopAnswers === undefined
					? []
					: [{ name: "laptop", url: laptopUrl }]),
			],
		},
		factoryFetch(
			{
				[hubUrl]: hubAnswers,
				...(laptopAnswers === undefined ? {} : { [laptopUrl]: laptopAnswers }),
			},
			requests,
		),
		{
			env: { GITHUB_TOKEN: "recorded-token" },
			now,
		},
	);
	return { ...app, requests };
}

/** `GET /api/factories`, once its answer meets `accept`. */
export async function factoriesWhere(
	base: string,
	accept: (page: FactoriesPage) => boolean,
): Promise<FactoriesPage> {
	while (true) {
		const response = await fetch(new URL("/api/factories", base));
		if (response.status === 200) {
			const page = (await response.json()) as FactoriesPage;
			if (accept(page)) {
				return page;
			}
		}
		await Bun.sleep(20);
	}
}
