import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { readOverview, settledOverview } from "../support/reads.ts";
import {
	type Connection,
	type GraphqlRequest,
	membership,
	operationName,
	renamed,
} from "./_support.ts";

type ProjectTickets = { doneTickets: { key: string; pullUrl?: string }[] };

const closedKey = "acme/widget#103";
const mergedUrl = "https://github.com/acme/widget/pull/90";

describe("merged pulls across full polls", () => {
	test("a full poll keeps a stored merged PR that its merged page left out, with no request for it", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const requests: GraphqlRequest[] = [];
		let reads = 0;
		let clock = Date.parse("2026-08-18T12:00:00.000Z");
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						requests.push(request);
						const body = renamed(owner, name);
						if (operationName(request.query) !== "RepoRead") {
							return body;
						}
						reads += 1;
						const repository = body.data.repository;
						const closed = structuredClone(repository.issues.nodes[0] ?? {});
						closed.number = 103;
						closed.id = "I_103";
						closed.title = "Ticket 103";
						closed.state = "CLOSED";
						closed.updatedAt = "2026-01-01T00:00:00.000Z";
						repository.issues.nodes.push(closed);
						const merged = repository.mergedPullRequests.nodes[0];
						if (merged === undefined || reads > 1) {
							repository.mergedPullRequests.nodes = [];
							return body;
						}
						merged.body = "Closes #103";
						const closing = merged.closingIssuesReferences as Connection<{
							number: number;
						}>;
						closing.nodes = [{ number: 103 }];
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date(clock),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const project = async () =>
				(await (
					await fetch(new URL("/api/projects/acme%2Fwidget", base))
				).json()) as ProjectTickets;
			const pullUrlOf = (body: ProjectTickets) =>
				body.doneTickets.find((ticket) => ticket.key === closedKey)?.pullUrl;
			expect(pullUrlOf(await project())).toBe(mergedUrl);
			const firstPoll = requests.length;
			clock += 11 * 60 * 1000;
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			await settledOverview(base, readOverview<Overview>);
			const later = requests.slice(firstPoll);
			expect(later.map((request) => request.variables.since)).toEqual([null]);
			expect(pullUrlOf(await project())).toBe(mergedUrl);
			expect(later.map((request) => operationName(request.query))).toEqual([
				"RepoRead",
			]);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
