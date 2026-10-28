import { describe, expect, test } from "bun:test";

import hubRuns from "../fixtures/factory-hub-runs.json";
import stageTranscript from "../fixtures/factory-stage-transcript.json";
import {
	daemon,
	type FactoryRequest,
	hub,
	hubUrl,
} from "../support/factory.ts";
import { settledRead } from "../support/reads.ts";
import { boxRow, factoryRunOf, overviewWhere, serveRuns } from "./_support.ts";

const [running41] = hubRuns.runs;
if (running41 === undefined) {
	throw new Error("the hub runs fixture lost a run");
}
const stage = "conceptual/review";
const transcriptPath = `/runs/${running41.id}/stages/${stage}/transcript`;

const shownEntries = [
	{
		id: 7,
		folder: "conceptual@v1.a1/child/review@v1.a1",
		visit: 1,
		attempt: 1,
		at: "2026-10-25T14:05:01+00:00",
		kind: "message",
		text: "I read the diff of the branch first.",
	},
	{
		id: 8,
		folder: "conceptual@v1.a1/child/review@v1.a1",
		visit: 1,
		attempt: 1,
		at: "2026-10-25T14:05:03+00:00",
		kind: "tool_call",
		name: "Bash",
		input: '{"command": "git diff origin/main...HEAD"}',
		truncated: false,
	},
];

async function transcriptOf(
	base: string,
	after: number,
	runId: string = running41?.id ?? "",
): Promise<Response> {
	await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
	const query = new URLSearchParams({ stage, after: String(after) });
	return settledRead(
		new URL(
			`/api/factory-runs/${encodeURIComponent(runId)}/transcript?${query}`,
			base,
		),
	);
}

const readsOf = (requests: FactoryRequest[], path: string) => [
	...new Set(
		requests
			.filter((request) => new URL(request.url).pathname === path)
			.map((request) => request.url),
	),
];

describe("the stage transcript", () => {
	test("a run on a box gives the messages and tool calls of a child graph stage through the hub", async () => {
		const app = await serveRuns(
			{ ...hub, [transcriptPath]: stageTranscript },
			[41],
		);
		try {
			const response = await transcriptOf(app.base, 0);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				entries: shownEntries,
				next: 8,
			});
			expect(readsOf(app.requests, transcriptPath)).toEqual([
				`${hubUrl}${transcriptPath}?after=0`,
			]);
		} finally {
			await app.stop();
		}
	});

	test("a read with the after cursor gives only the entries that a live stage added since", async () => {
		const entries = [...stageTranscript.entries];
		const page = (url: URL) => {
			const after = Number(url.searchParams.get("after") ?? "0");
			const found = entries.filter((entry) => entry.id > after);
			return { entries: found, next: found.at(-1)?.id ?? after };
		};
		const app = await serveRuns({ ...hub, [transcriptPath]: page }, [41]);
		try {
			const first = (await (await transcriptOf(app.base, 0)).json()) as {
				next: number;
			};
			expect(first.next).toBe(8);
			entries.push({
				id: 9,
				visit: 1,
				attempt: 1,
				stage: "conceptual@v1.a1/child/review@v1.a1",
				kind: "message",
				recorded_at: "2026-10-25T14:05:09+00:00",
				text: "The diff adds one route.",
			});
			const response = await transcriptOf(app.base, first.next);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				entries: [
					{
						id: 9,
						folder: "conceptual@v1.a1/child/review@v1.a1",
						visit: 1,
						attempt: 1,
						at: "2026-10-25T14:05:09+00:00",
						kind: "message",
						text: "The diff adds one route.",
					},
				],
				next: 9,
			});
			expect(readsOf(app.requests, transcriptPath)).toContain(
				`${hubUrl}${transcriptPath}?after=8`,
			);
		} finally {
			await app.stop();
		}
	});

	test("a run that a hub and its box report reads the transcript from the hub, and the box gets no read", async () => {
		const app = await serveRuns(
			{ ...hub, [transcriptPath]: stageTranscript },
			[41],
			{},
			{
				...daemon,
				"/runs": { runs: [boxRow(running41, "running")] },
				[transcriptPath]: stageTranscript,
			},
		);
		try {
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
			);
			expect((await transcriptOf(app.base, 0)).status).toBe(200);
			expect(readsOf(app.requests, transcriptPath)).toEqual([
				`${hubUrl}${transcriptPath}?after=0`,
			]);
		} finally {
			await app.stop();
		}
	});

	test("a factory that answers 404 reports the transcript as not served, and a run that no factory reports answers missing", async () => {
		const app = await serveRuns(hub, [41]);
		try {
			const notServed = await transcriptOf(app.base, 0);
			expect(notServed.status).toBe(404);
			expect(await notServed.json()).toEqual({ notServed: true });
			const missing = await transcriptOf(app.base, 0, "no-such-run");
			expect(missing.status).toBe(404);
			expect(await missing.json()).toEqual({ missing: true });
		} finally {
			await app.stop();
		}
	});
});

describe("the steer of a stage", () => {
	test("a steer to a child graph stage reaches the factory with the node path of that stage", async () => {
		const steerPath = `/runs/${running41.id}/steer`;
		const steer = { stage, text: "Check the tests too", interrupt: false };
		const app = await serveRuns(
			{
				...hub,
				[steerPath]: { id: 1, run_id: running41.id, ...steer, sender: "lev" },
			},
			[41],
		);
		try {
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			const response = await fetch(
				new URL(`/api/factory-runs/${running41.id}/steer`, app.base),
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(steer),
				},
			);
			expect(response.status).toBe(200);
			expect(
				app.requests.filter((request) => request.method === "POST"),
			).toEqual([
				{
					url: `${hubUrl}${steerPath}`,
					unix: null,
					method: "POST",
					body: JSON.stringify({ ...steer, sender: "lev" }),
				},
			]);
		} finally {
			await app.stop();
		}
	});
});
