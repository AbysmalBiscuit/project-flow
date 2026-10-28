import { describe, expect, test } from "bun:test";

import {
	boxRow,
	factoryRunOf,
	overviewWhere,
	serveRuns,
} from "./factory-run-support.ts";
import { daemon, type FactoryRequest, hub, hubUrl } from "./factory-support.ts";
import hubRuns from "./fixtures/factory-hub-runs.json";
import runFiles from "./fixtures/factory-run-files.json";
import runSandbox from "./fixtures/factory-run-sandbox.json";
import { settledRead } from "./support.ts";

describe("factory runs", () => {
	describe("the files changed", () => {
		const running41 = hubRuns.runs[0]?.id ?? "";
		const filesPath = `/runs/${running41}/files`;
		const sandboxPath = `/runs/${running41}/sandbox`;

		async function filesOf(base: string, runId = running41): Promise<Response> {
			await overviewWhere(base, (seen) => factoryRunOf(seen, 41) !== undefined);
			return settledRead(
				new URL(`/api/factory-runs/${encodeURIComponent(runId)}/files`, base),
			);
		}

		/** Each files URL that the app read, once: a stale read reads again in the background. */
		const filesRequests = (requests: FactoryRequest[]) => [
			...new Set(
				requests
					.filter((request) => new URL(request.url).pathname === filesPath)
					.map((request) => request.url),
			),
		];

		test("a run on a box gives each changed file with its status, line counts and diff through the hub", async () => {
			const app = await serveRuns({ ...hub, [filesPath]: runFiles }, [41]);
			try {
				const response = await filesOf(app.base);
				expect(response.status).toBe(200);
				const [gone, kept, added, renamed] = runFiles.files;
				expect(await response.json()).toEqual({
					files: [
						{
							path: "gone.txt",
							status: "deleted",
							additions: 0,
							deletions: 1,
							patch: gone?.patch,
						},
						{
							path: "kept.txt",
							status: "modified",
							additions: 1,
							deletions: 1,
							patch: kept?.patch,
						},
						{
							path: "new.txt",
							status: "added",
							additions: 2,
							deletions: 0,
							patch: added?.patch,
						},
						{
							path: "renamed.txt",
							previousPath: "moved.txt",
							status: "renamed",
							additions: 0,
							deletions: 0,
							patch: renamed?.patch,
						},
					],
				});
				expect(filesRequests(app.requests)).toEqual([`${hubUrl}${filesPath}`]);
			} finally {
				await app.stop();
			}
		});

		test("a run that a hub and its box report reads its files from the hub, and the box gets no read", async () => {
			const [row41] = hubRuns.runs;
			if (row41 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const app = await serveRuns(
				{ ...hub, [filesPath]: runFiles },
				[41],
				{},
				{
					...daemon,
					"/runs": { runs: [boxRow(row41, "running")] },
					[filesPath]: runFiles,
				},
			);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.factory === "laptop",
				);
				expect((await filesOf(app.base)).status).toBe(200);
				expect(filesRequests(app.requests)).toEqual([`${hubUrl}${filesPath}`]);
			} finally {
				await app.stop();
			}
		});

		test("a factory that answers 404 on the files reports them as not served", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await filesOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		/** The files route of a factory answers 404, and its sandbox route answers `sandbox`. */
		function filesMissingWithSandbox(sandbox: unknown) {
			return serveRuns(
				{
					...hub,
					[filesPath]: Response.json(
						{ error: "the files are not available" },
						{ status: 404 },
					),
					[sandboxPath]: sandbox,
				},
				[41],
			);
		}

		test("a files 404 for a run whose sandbox is removed reports its files as gone", async () => {
			const app = await filesMissingWithSandbox({
				...runSandbox,
				state: "removed",
			});
			try {
				const response = await filesOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ gone: true });
			} finally {
				await app.stop();
			}
		});

		test("a files 404 for a run whose sandbox still has its worktree reports the files as not served", async () => {
			const app = await filesMissingWithSandbox({
				...runSandbox,
				state: "clean",
			});
			try {
				const response = await filesOf(app.base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ notServed: true });
			} finally {
				await app.stop();
			}
		});

		test("a files 404 for a run with no worktree yet, or whose sandbox read fails, reports the files as missing", async () => {
			for (const sandbox of [
				{ ...runSandbox, worktree: null, state: "none" },
				Response.json({ error: "the box did not answer" }, { status: 502 }),
			]) {
				const app = await filesMissingWithSandbox(sandbox);
				try {
					const response = await filesOf(app.base);
					expect(response.status).toBe(404);
					expect(await response.json()).toEqual({ missing: true });
				} finally {
					await app.stop();
				}
			}
		});

		test("a run that no factory reports answers 404", async () => {
			const app = await serveRuns(hub, [41]);
			try {
				const response = await filesOf(app.base, "no-such-run");
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ missing: true });
			} finally {
				await app.stop();
			}
		});
	});
});
