import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PullRequest, Snapshot } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { pendingStatus } from "../../src/stale-reads.ts";
import { sqliteStore } from "../../src/store.ts";
import { devkitWorktree } from "../support/checkouts.ts";
import {
	host,
	hostedWidget,
	hosts,
	recordingFetch,
	widget,
	withStarted,
} from "./_support.ts";

const hostedName = `${host}/acme/widget`;

function storedPull(number: number, extra: Partial<PullRequest>): PullRequest {
	return {
		repo: "acme/widget",
		number,
		url: `https://${host}/acme/widget/pull/${number}`,
		title: `Change ${number}`,
		draft: false,
		branch: `change-${number}`,
		body: "",
		closingKeys: [],
		headSha: "head",
		headCommittedAt: null,
		merged: false,
		checks: [],
		comments: [],
		reviews: [],
		reactions: [],
		...extra,
	};
}

/** Runs the checks on an app whose store holds one row of the declared host. */
async function withHostedRow(
	row: Pick<Snapshot, "pulls" | "tickets">,
	configuration: Record<string, unknown>,
	checks: (base: string) => Promise<void>,
	fetchImpl?: Fetch,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-hosts-"));
	const databasePath = join(root, "project-flow.sqlite");
	const seeded = sqliteStore(databasePath);
	seeded.store.mergeTickets([
		{
			key: "acme/widget",
			name: hostedName,
			tracker: "github",
			host,
			branches: [],
			startedKeys: [],
			...row,
		},
	]);
	seeded.close();
	try {
		await withStarted(
			{ hosts, tracked: [hostedWidget], ...configuration },
			checks,
			fetchImpl,
			databasePath,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** The state of each card of the project on the declared host, by the number of its PR. */
async function hostedPullStates(base: string): Promise<Record<string, string>> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(hostedName)}`, base),
	);
	expect(response.status).toBe(200);
	const report = (await response.json()) as {
		tickets: { pull?: string; state: string }[];
	};
	return Object.fromEntries(
		report.tickets.flatMap((ticket) =>
			ticket.pull === undefined ? [] : [[ticket.pull, ticket.state]],
		),
	);
}

describe("a route to a project on a declared host", () => {
	const ticket = {
		id: "1",
		tracker: "github" as const,
		key: "acme/widget#1",
		title: "A ticket",
		state: "open" as const,
		stateReason: null,
		updatedAt: "2026-10-01T10:00:00.000Z",
		body: "",
		blockedBy: [],
		milestone: null,
		parent: null,
		labels: [],
	};
	const target = {
		tracker: "github",
		project: hostedName,
		key: "acme/widget#1",
	};

	async function expectNoHomeCall(
		ask: (base: string) => Promise<Response>,
		expected: unknown,
	): Promise<void> {
		const sent: { url: string; authorization: string | null }[] = [];
		await withHostedRow(
			{ pulls: [], tickets: [ticket] },
			{ tracked: [widget, hostedWidget] },
			async (base) => {
				const asked = sent.length;
				const response = await ask(base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual(expected);
				expect(sent.slice(asked)).toEqual([]);
			},
			recordingFetch(sent),
		);
	}

	const post = (base: string, path: string, body: unknown) =>
		fetch(new URL(path, base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

	test("a reply does not reach the home tracker", async () => {
		await expectNoHomeCall(
			(base) => post(base, "/api/replies", { ...target, body: "Done." }),
			{ error: "tracker unavailable" },
		);
	});

	test("a thread read does not reach the home tracker", async () => {
		await expectNoHomeCall(
			async (base) => {
				const url = new URL(
					`/api/threads/github/${encodeURIComponent(target.key)}?project=${encodeURIComponent(hostedName)}`,
					base,
				);
				let response = await fetch(url);
				while (response.status === pendingStatus) {
					await Bun.sleep(10);
					response = await fetch(url);
				}
				return response;
			},
			{ missing: true },
		);
	});

	test("a run start does not reach the home tracker", async () => {
		await expectNoHomeCall((base) => post(base, "/api/run-starts", target), {
			error: "tracker unavailable",
		});
	});
});

describe("the review rules of a PR on a declared host", () => {
	const finished = "awaitingMerge";
	const waiting = "inReview";

	test("the expected bots of the PR come from the key of its own host", async () => {
		await withHostedRow(
			{
				pulls: [storedPull(1, { host }), storedPull(2, {})],
				tickets: [],
			},
			{ expectedBots: { [hostedName]: ["grok"] } },
			async (base) => {
				expect(await hostedPullStates(base)).toEqual({
					"acme/widget#1": waiting,
					"acme/widget#2": finished,
				});
			},
		);
	});

	test("an auto-merge override under the bare repo key does not reach the PR", async () => {
		await withHostedRow(
			{ pulls: [storedPull(1, { host })], tickets: [] },
			{ autoMerge: { "acme/widget": "yes" } },
			async (base) => {
				expect(await hostedPullStates(base)).toEqual({
					"acme/widget#1": finished,
				});
			},
		);
	});

	test("an auto-merge override under the host key reaches the PR", async () => {
		await withHostedRow(
			{
				pulls: [storedPull(1, { host, repo: "acme/other" })],
				tickets: [],
			},
			{ autoMerge: { [`${host}/acme/other`]: "yes" } },
			async (base) => {
				expect(await hostedPullStates(base)).toEqual({
					"acme/other#1": waiting,
				});
			},
		);
	});

	test("the bare project key does not reach another repo of the project", async () => {
		await withHostedRow(
			{
				pulls: [storedPull(1, { host, repo: "acme/other" })],
				tickets: [],
			},
			{ autoMerge: { "acme/widget": "yes" } },
			async (base) => {
				expect(await hostedPullStates(base)).toEqual({
					"acme/other#1": finished,
				});
			},
		);
	});

	test("the workcell auto-merge of the same repo name on github.com does not reach the PR", async () => {
		const checkout = await devkitWorktree({
			key: "acme/widget#5",
			status: "running",
			mergeAuto: { merge: "yes" },
		});
		try {
			await withHostedRow(
				{
					pulls: [storedPull(1, { host, closingKeys: ["acme/widget#5"] })],
					tickets: [
						{
							id: "5",
							tracker: "github",
							key: "acme/widget#5",
							title: "A ticket",
							state: "open",
							stateReason: null,
							updatedAt: "2026-10-01T10:00:00.000Z",
							body: "",
							blockedBy: [],
							milestone: null,
							parent: null,
							labels: [],
							comments: [
								{
									body: `**Workcell progress**\n\n- final report sent https://${host}/acme/widget/pull/1`,
									createdAt: "2026-10-01T10:00:00.000Z",
								},
							],
						},
					],
				},
				{ checkoutRoots: [checkout.root] },
				async (base) => {
					const response = await fetch(
						new URL(`/api/projects/${encodeURIComponent(hostedName)}`, base),
					);
					const report = (await response.json()) as {
						tickets: { key: string; state: string }[];
					};
					expect(
						report.tickets.find((ticket) => ticket.key === "acme/widget#5")
							?.state,
					).toBe(finished);
				},
			);
		} finally {
			await checkout.cleanup();
		}
	});
});
