import { describe, expect, test } from "bun:test";

import type {
	NeedsYouItem,
	ProjectReport,
	Snapshot,
	Ticket,
} from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { pendingStatus } from "../../src/stale-reads.ts";
import type { TicketSearchHit } from "../../src/ticket-key.ts";
import { devkitWorktree } from "../support/checkouts.ts";
import {
	host,
	hostedWidget,
	hosts,
	recordingFetch,
	storedPull,
	tokenEnv,
	widget,
	withStoredRow,
} from "./_support.ts";

const hostedName = `${host}/acme/widget`;

/** Runs the checks on an app whose store holds one row of the declared host. */
function withHostedRow(
	row: Pick<Snapshot, "pulls" | "tickets">,
	configuration: Record<string, unknown>,
	checks: (base: string) => Promise<void>,
	fetchImpl?: Fetch,
	rowHost: string = host,
): Promise<void> {
	return withStoredRow(
		{
			key: "acme/widget",
			name: `${rowHost}/acme/widget`,
			tracker: "github",
			host: rowHost,
			branches: [],
			startedKeys: [],
			...row,
		},
		{ hosts, tracked: [hostedWidget], ...configuration },
		checks,
		fetchImpl,
	);
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

describe("the pages of a project on a declared host with a port", () => {
	const portHost = `${host}:8443`;
	const page = `https://${portHost}/acme/widget`;
	const ticket = (number: number, body: string): Ticket => ({
		id: String(number),
		tracker: "github",
		key: `acme/widget#${number}`,
		title: `Ticket ${number}`,
		state: "open",
		stateReason: null,
		updatedAt: "2026-10-01T00:00:00.000Z",
		body,
		blockedBy: [],
		milestone: null,
		parent: null,
		labels: [],
		url: `${page}/issues/${number}`,
	});

	test("a ticket, its graph ends and its PR keep the host and the forge label", async () => {
		await withHostedRow(
			{
				tickets: [ticket(1, ""), ticket(2, "Blocked by: #1")],
				pulls: [
					{
						...storedPull(7, { host: portHost }),
						url: `${page}/pull/7`,
						closingKeys: ["acme/widget#2"],
					},
				],
			},
			{
				hosts: [{ host: portHost, forge: "github", tokenEnv }],
				tracked: [{ ...widget, host: portHost }],
			},
			async (base) => {
				const response = await fetch(
					new URL(
						`/api/projects/${encodeURIComponent(`${portHost}/acme/widget`)}`,
						base,
					),
				);
				const report = (await response.json()) as ProjectReport;
				const second = report.tickets.find(
					(item) => item.key === "acme/widget#2",
				);
				expect(second?.url).toBe(`${page}/issues/2`);
				expect(second?.pullUrl).toBe(`${page}/pull/7`);
				expect(second?.pullForge).toBe("GitHub");
				const needs = report.sections.find(
					(section) => section.id === "needsYou",
				)?.needsYou;
				expect(needs?.[0]?.pull?.forge).toBe("GitHub");
				const needsYou = (await (
					await fetch(new URL("/api/needs-you", base))
				).json()) as NeedsYouItem[];
				expect(needsYou.find((item) => item.key === "acme/widget#2")?.url).toBe(
					`${page}/issues/2`,
				);
				const hits = (await (
					await fetch(new URL("/api/search?q=acme%2Fwidget%232", base))
				).json()) as TicketSearchHit[];
				expect(hits.map((hit) => hit.url)).toEqual([`${page}/issues/2`]);
				const link = report.graphLinks[0];
				expect(link?.from.url).toBe(`${page}/issues/1`);
				expect(link?.to.url).toBe(`${page}/issues/2`);
			},
			undefined,
			portHost,
		);
	});
});
