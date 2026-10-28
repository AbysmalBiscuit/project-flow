import { describe, expect, test } from "bun:test";

import type { RunListRow } from "../../src/run-list.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import runDetail from "../fixtures/factory-run-detail.json";
import { daemon, hub } from "../support/factory.ts";
import { pull, repo } from "../support/github.ts";
import { githubPullNode } from "../support/repo-read.ts";
import { boxRow, serveRuns } from "./_support.ts";

describe("the runs list", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}

	async function runsWhere(
		base: string,
		accept: (rows: RunListRow[]) => boolean,
	): Promise<RunListRow[]> {
		while (true) {
			const response = await fetch(new URL("/api/factory-runs", base));
			expect(response.status).toBe(200);
			const rows = (await response.json()) as RunListRow[];
			if (accept(rows)) {
				return rows;
			}
			await Bun.sleep(20);
		}
	}

	test("lists the runs of every factory, live and ended, once for each run id, newest first", async () => {
		const laptopRun = {
			...boxRow(running41, "succeeded"),
			id: "20261025-143000-d1e2",
			ticket: "43",
			submitted_at: "2026-10-25T14:30:00+00:00",
			started_at: "2026-10-25T14:30:04+00:00",
			ended_at: "2026-10-25T14:52:00+00:00",
		};
		const app = await serveRuns(
			hub,
			[39, 40, 41, 42, 43],
			{},
			{
				...daemon,
				"/runs": { runs: [laptopRun, boxRow(running41, "blocked")] },
			},
		);
		try {
			const rows = await runsWhere(
				app.base,
				(seen) =>
					seen.length === 5 &&
					seen.every((row) => row.title !== undefined) &&
					seen.some((row) => row.id === running41.id && row.box === "laptop"),
			);
			expect(
				rows.map((row) => [
					row.id,
					row.key,
					row.title,
					row.project,
					row.statusKind,
					row.factory,
					row.box,
				]),
			).toEqual([
				[
					laptopRun.id,
					`${repo}#43`,
					"Ticket 43",
					repo,
					"succeeded",
					"laptop",
					"laptop",
				],
				[
					"20261025-141500-e5f6",
					`${repo}#42`,
					"Ticket 42",
					repo,
					"queued",
					"work hub",
					null,
				],
				[
					running41.id,
					`${repo}#41`,
					"Ticket 41",
					repo,
					"blocked",
					"laptop",
					"laptop",
				],
				[
					"20261025-130511-c3d4",
					`${repo}#40`,
					"Ticket 40",
					repo,
					"succeeded",
					"work hub",
					"box-b",
				],
				[
					"20261025-120000-a7b8",
					`${repo}#39`,
					"Ticket 39",
					repo,
					"failed",
					"work hub",
					"box-a",
				],
			]);
		} finally {
			await app.stop();
		}
	});

	test("each run gives the usage totals that its factory lists, and the box row wins over the hub row", async () => {
		const usage = (input: number, cost: number, seconds: number) => ({
			tokens: { input, output: input / 10 },
			cost_usd: cost,
			duration_s: seconds,
		});
		const [, succeeded40, queued42, failed39] = hubRuns.runs;
		if (
			succeeded40 === undefined ||
			queued42 === undefined ||
			failed39 === undefined
		) {
			throw new Error("the hub runs fixture lost a run");
		}
		const app = await serveRuns(
			{
				...hub,
				"/runs": {
					runs: [
						{ ...running41, usage: usage(1000, 0.25, 30) },
						{ ...succeeded40, usage: usage(5000, 1.5, 300) },
						{ ...queued42, usage: usage(0, 0, 0) },
						failed39,
					],
				},
			},
			[39, 40, 41, 42],
			{},
			{
				...daemon,
				"/runs": {
					runs: [
						{
							...boxRow(running41, "running"),
							usage: usage(2000, 0.5, 60),
						},
					],
				},
			},
		);
		try {
			const rows = await runsWhere(app.base, (seen) =>
				seen.some((row) => row.id === running41.id && row.box === "laptop"),
			);
			expect(
				Object.fromEntries(rows.map((row) => [row.id, row.usageTotals])),
			).toEqual({
				[running41.id]: {
					inputTokens: 2000,
					outputTokens: 200,
					costUsd: 0.5,
					durationS: 60,
				},
				[succeeded40.id]: {
					inputTokens: 5000,
					outputTokens: 500,
					costUsd: 1.5,
					durationS: 300,
				},
				[queued42.id]: {
					inputTokens: 0,
					outputTokens: 0,
					costUsd: 0,
					durationS: 0,
				},
				[failed39.id]: undefined,
			});
		} finally {
			await app.stop();
		}
	});

	test("a run of an untracked ticket gives its repo key", async () => {
		const app = await serveRuns(hub, [41]);
		try {
			const rows = await runsWhere(app.base, (seen) =>
				seen.some((row) => row.title !== undefined),
			);
			const untracked = rows.find((row) => row.id === "20261025-130511-c3d4");
			expect(untracked).toMatchObject({ key: `${repo}#40`, project: repo });
			expect(untracked).not.toHaveProperty("title");
		} finally {
			await app.stop();
		}
	});

	test("each run gives the PR that it opened and its result, and two runs of one ticket each give their own", async () => {
		/** A run row of `ticket` that ended with `status`. */
		const ended = (
			id: string,
			ticket: string,
			status: { kind: string; reason: string | null },
		) => ({
			...running41,
			id,
			ticket,
			status,
			submitted_at: `2026-10-25T${id.slice(9, 11)}:00:00+00:00`,
			ended_at: "2026-10-25T13:00:00+00:00",
		});
		/** The `GET /runs/{id}` answer of `row`, with the PR that it opened. */
		const detail = (
			row: { id: string; ticket: string },
			number: number | null,
			mergeSha: string | null = null,
		) => ({
			...runDetail,
			...row,
			outputs: {
				...runDetail.outputs,
				issue: row.ticket,
				pr_url:
					number === null ? null : `https://github.com/${repo}/pull/${number}`,
				merge_sha: mergeSha,
			},
			pr:
				number === null
					? null
					: {
							...runDetail.pr,
							number,
							url: `https://github.com/${repo}/pull/${number}`,
						},
		});
		const [, prOpen40, queued42, failed39] = hubRuns.runs;
		if (
			prOpen40 === undefined ||
			queued42 === undefined ||
			failed39 === undefined
		) {
			throw new Error("the hub runs fixture lost a run");
		}
		const merged41 = ended("20261025-100000-0000", "41", {
			kind: "succeeded",
			reason: null,
		});
		const noPr43 = ended("20261025-090000-0043", "43", {
			kind: "succeeded",
			reason: null,
		});
		const cancelled44 = ended("20261025-080000-0044", "44", {
			kind: "failed",
			reason: "stopped",
		});
		const mergedUntracked = ended("20261025-070000-0038", "38", {
			kind: "succeeded",
			reason: null,
		});
		const app = await serveRuns(
			{
				...hub,
				"/runs": {
					runs: [
						...hubRuns.runs,
						merged41,
						noPr43,
						cancelled44,
						mergedUntracked,
					],
				},
				[`/runs/${running41.id}`]: detail(running41, 77),
				[`/runs/${prOpen40.id}`]: runDetail,
				[`/runs/${failed39.id}`]: detail(failed39, null),
				[`/runs/${merged41.id}`]: detail(merged41, 70),
				[`/runs/${noPr43.id}`]: detail(noPr43, null),
				[`/runs/${cancelled44.id}`]: detail(cancelled44, null),
				[`/runs/${mergedUntracked.id}`]: detail(
					mergedUntracked,
					60,
					"b".repeat(40),
				),
			},
			[39, 40, 41, 43, 44],
			{},
			undefined,
			[
				githubPullNode(pull(77, 41)),
				githubPullNode(pull(72, 40, undefined, true)),
			],
			[
				githubPullNode({
					...pull(70, 41),
					state: "closed",
					merged_at: "2026-10-25T09:50:00Z",
				}),
			],
		);
		try {
			const rows = await runsWhere(
				app.base,
				(seen) =>
					seen.filter((row) => row.pull !== undefined).length === 4 &&
					seen.filter((row) => row.title !== undefined).length === 6,
			);
			expect(
				rows.map((row) => [row.key, row.statusKind, row.pull, row.result]),
			).toEqual([
				[`${repo}#42`, "queued", undefined, undefined],
				[
					`${repo}#41`,
					"running",
					{ number: 77, url: `https://github.com/${repo}/pull/77` },
					undefined,
				],
				[
					`${repo}#40`,
					"succeeded",
					{ number: 72, url: `https://github.com/${repo}/pull/72` },
					"prOpen",
				],
				[`${repo}#39`, "failed", undefined, "failed"],
				[
					`${repo}#41`,
					"succeeded",
					{ number: 70, url: `https://github.com/${repo}/pull/70` },
					"merged",
				],
				[`${repo}#43`, "succeeded", undefined, "noPr"],
				[`${repo}#44`, "failed", undefined, "cancelled"],
				[
					`${repo}#38`,
					"succeeded",
					{ number: 60, url: `https://github.com/${repo}/pull/60` },
					"merged",
				],
			]);
			expect(
				app.requests.some((request) =>
					request.url.endsWith(`/runs/${queued42.id}`),
				),
			).toBe(false);
		} finally {
			await app.stop();
		}
	});
});
