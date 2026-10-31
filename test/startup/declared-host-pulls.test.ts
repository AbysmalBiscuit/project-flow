import { describe, expect, test } from "bun:test";

import type { NeedsYouItem, PullRequest, Snapshot } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import runDetail from "../fixtures/factory-run-detail.json";
import { githubFetch } from "../review-github-fake.ts";
import { devkitWorktree } from "../support/checkouts.ts";
import { factoryFetch, hub, hubUrl } from "../support/factory.ts";
import { codex } from "../support/github.ts";
import {
	readOverview,
	readWhere,
	settledOverview,
	settledRead,
} from "../support/reads.ts";
import {
	host,
	hostedWidget,
	hosts,
	openTicket,
	recordedFetch,
	storedPull,
	widget,
	widgetRow,
	withStoredRows,
} from "./_support.ts";

const hostedKey = `${host}/acme/widget`;

type BotRow = {
	key: string;
	host?: string;
	repos: string[];
	repoBots: Record<string, string[]>;
};

describe("a PR number on github.com and on a declared host", () => {
	const homeMerged = {
		number: 1,
		title: "Change 1",
		state: "closed",
		draft: false,
		html_url: "https://github.com/acme/widget/pull/1",
		head: { ref: "change-1", sha: "head" },
		body: "",
		merged_at: "2026-10-01T00:00:00Z",
	};
	const hostedMerged = storedPull(1, {
		host,
		merged: true,
		checks: [
			{ name: "grok review", status: "completed", conclusion: "success" },
		],
	});
	const github: Fetch = githubFetch({
		issues: [],
		pulls: [],
		checksBySha: {},
		commentsByPull: { 1: [{ user: { login: codex }, body: "Reviewed." }] },
		reviewsByPull: {},
		reactionsByPull: {},
		mergedPulls: [homeMerged],
	});

	test("an incremental poll keeps both PRs, each with its own bot history", async () => {
		await withStoredRows(
			[widgetRow({ pulls: [hostedMerged] })],
			{ hosts, tracked: [widget] },
			async (base) => {
				const settings = await readWhere<{ projects: BotRow[] }>(
					new URL("/api/settings", base),
					({ projects }) =>
						projects.some(
							(row) =>
								row.key === "acme/widget" &&
								row.host === undefined &&
								row.repoBots["acme/widget"] !== undefined,
						),
				);
				const row = settings.projects.find(
					(item) => item.key === "acme/widget" && item.host === undefined,
				);
				expect(row?.repos.toSorted()).toEqual(["acme/widget", hostedKey]);
				expect(row?.repoBots).toEqual({
					"acme/widget": ["codex"],
					[hostedKey]: ["grok"],
				});
			},
			github,
			new Date(Date.now() - 60 * 1000),
		);
	});
	test("a full poll keeps the merged PR on the host that a ticket links", async () => {
		const linkedHosted = { ...hostedMerged, closingKeys: ["acme/widget#5"] };
		const full: Fetch = githubFetch({
			issues: [
				{
					number: 5,
					title: "Ticket 5",
					state: "open",
					state_reason: null,
					updated_at: "2026-10-01T10:00:00.000Z",
					html_url: "https://github.com/acme/widget/issues/5",
					body: "",
				},
			],
			pulls: [],
			checksBySha: {},
			commentsByPull: { 1: [{ user: { login: codex }, body: "Reviewed." }] },
			reviewsByPull: {},
			reactionsByPull: {},
			mergedPulls: [homeMerged],
		});
		await withStoredRows(
			[widgetRow({ pulls: [linkedHosted] })],
			{ hosts, tracked: [widget] },
			async (base) => {
				const settings = await readWhere<{ projects: BotRow[] }>(
					new URL("/api/settings", base),
					({ projects }) =>
						projects.some(
							(row) =>
								row.key === "acme/widget" &&
								row.host === undefined &&
								row.repoBots["acme/widget"] !== undefined,
						),
				);
				const row = settings.projects.find(
					(item) => item.key === "acme/widget" && item.host === undefined,
				);
				expect(row?.repos.toSorted()).toEqual(["acme/widget", hostedKey]);
			},
			full,
		);
	});
});

describe("a project that holds PR #1 on github.com and on a declared host", () => {
	const homeUrl = "https://github.com/acme/widget/pull/1";
	const hostedUrl = `https://${host}/acme/widget/pull/1`;
	const closingTicket = ["acme/widget#5"];
	const homePull = (extra: Partial<PullRequest>) =>
		storedPull(1, { url: homeUrl, ...extra });
	const hostedPull = (extra: Partial<PullRequest>) =>
		storedPull(1, { host, ...extra });
	const openAsk: PullRequest["comments"][number] = {
		login: "agent",
		body: "This waits on Lev for the signing key.\n\n<!-- workcell:ask pr-1 -->",
		createdAt: "2026-10-01T00:00:00Z",
	};

	function withPulls(
		row: Partial<Snapshot>,
		configuration: Record<string, unknown>,
		checks: (base: string) => Promise<void>,
	): Promise<void> {
		return withStoredRows(
			[widgetRow({ name: hostedKey, host, ...row })],
			{ hosts, tracked: [hostedWidget], ...configuration },
			checks,
		);
	}

	async function needsYouUrls(base: string): Promise<(string | undefined)[]> {
		const response = await settledRead(new URL("/api/needs-you", base));
		const items = (await response.json()) as NeedsYouItem[];
		return items.map((item) => item.pull?.url);
	}

	test("the project report marks only the PR that needs you", async () => {
		await withPulls(
			{
				pulls: [homePull({ comments: [openAsk] }), hostedPull({ draft: true })],
			},
			{},
			async (base) => {
				const response = await settledRead(
					new URL(`/api/projects/${encodeURIComponent(hostedKey)}`, base),
				);
				const report = (await response.json()) as {
					tickets: { pullUrl?: string; needsYou?: true }[];
				};
				expect(
					report.tickets.flatMap(({ pullUrl, needsYou }) =>
						pullUrl === undefined ? [] : [{ pullUrl, needsYou }],
					),
				).toEqual([
					{ pullUrl: homeUrl, needsYou: true },
					{ pullUrl: hostedUrl, needsYou: undefined },
				]);
			},
		);
	});

	test("an ask on the PR on github.com notifies while the PR on the host already asks", async () => {
		const homeAsk = {
			number: 1,
			title: "Change 1",
			state: "open",
			draft: false,
			html_url: homeUrl,
			head: { ref: "change-1", sha: "head" },
			body: "",
		};
		const recorded = {
			issues: [],
			pulls: [] as Record<string, unknown>[],
			checksBySha: {},
			commentsByPull: {
				1: [
					{
						user: { login: "agent" },
						body: openAsk.body,
						created_at: "2026-10-02T00:00:00Z",
					},
				],
			},
			reviewsByPull: {},
			reactionsByPull: {},
		};
		await withStoredRows(
			[widgetRow({ pulls: [hostedPull({ comments: [openAsk] })] })],
			{ hosts, tracked: [widget] },
			async (base) => {
				await settledOverview(base, readOverview<{ polling?: true }>);
				expect(await needsYouUrls(base)).toEqual([hostedUrl]);
				recorded.pulls.push(homeAsk);
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const inbox = await readWhere<{ trigger: string; key: string }[]>(
					new URL("/api/inbox", base),
					(entries) => entries.length > 0,
				);
				expect(inbox.map(({ trigger, key }) => ({ trigger, key }))).toEqual([
					{ trigger: "needsYou", key: "acme/widget#1" },
				]);
				expect((await needsYouUrls(base)).toSorted()).toEqual(
					[homeUrl, hostedUrl].toSorted(),
				);
			},
			githubFetch(recorded),
			new Date(Date.now() - 60 * 1000),
		);
	});

	test("a link to the PR on github.com leaves the PR on the host unlinked", async () => {
		await withPulls(
			{
				pulls: [homePull({ closingKeys: closingTicket }), hostedPull({})],
			},
			{},
			async (base) => {
				const overview = await settledOverview(
					base,
					readOverview<{
						polling?: true;
						projects: { unlinkedPrs: { url: string }[] }[];
					}>,
				);
				expect(overview.projects[0]?.unlinkedPrs).toMatchObject([
					{ url: hostedUrl },
				]);
				expect(await needsYouUrls(base)).toEqual([homeUrl, hostedUrl]);
			},
		);
	});

	test("a link to the PR on github.com leaves the ask on the host's PR open", async () => {
		await withPulls(
			{
				pulls: [
					homePull({ closingKeys: closingTicket }),
					hostedPull({ comments: [openAsk] }),
				],
			},
			{},
			async (base) => {
				const response = await settledRead(new URL("/api/needs-you", base));
				const items = (await response.json()) as NeedsYouItem[];
				expect(
					items.find((item) => item.pull?.url === hostedUrl),
				).toMatchObject({ reason: "ask" });
			},
		);
	});

	test("an ask on the PR on github.com leaves the PR on the host awaiting merge", async () => {
		await withPulls(
			{ pulls: [homePull({ comments: [openAsk] }), hostedPull({})] },
			{},
			async (base) => {
				expect((await needsYouUrls(base)).toSorted()).toEqual(
					[homeUrl, hostedUrl].toSorted(),
				);
			},
		);
	});

	test("a workcell report of the PR on the host does not reach the PR on github.com", async () => {
		const checkout = await devkitWorktree({
			key: "acme/widget#5",
			status: "running",
			mergeAuto: { merge: "yes" },
		});
		try {
			const [ticket] = widgetRow({}).tickets;
			if (ticket === undefined) {
				throw new Error("the row holds no ticket");
			}
			await withPulls(
				{
					pulls: [hostedPull({ closingKeys: closingTicket }), homePull({})],
					tickets: [
						{
							...ticket,
							comments: [
								{
									body: `**Workcell progress**\n\n- final report sent ${hostedUrl}`,
									createdAt: "2026-10-01T10:00:00.000Z",
								},
							],
						},
					],
				},
				{ checkoutRoots: [checkout.root] },
				async (base) => {
					expect(await needsYouUrls(base)).toContain(homeUrl);
				},
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a workcell report of the linked PR on the host leaves the linked PR on github.com to Lev", async () => {
		const checkout = await devkitWorktree({
			key: "acme/widget#5",
			status: "running",
			mergeAuto: { merge: "yes" },
		});
		try {
			const [ticket] = widgetRow({}).tickets;
			if (ticket === undefined) {
				throw new Error("the row holds no ticket");
			}
			await withPulls(
				{
					pulls: [
						homePull({ closingKeys: closingTicket }),
						hostedPull({ closingKeys: closingTicket, autoMerge: true }),
					],
					tickets: [
						{
							...ticket,
							comments: [
								{
									body: `**Workcell progress**\n\n- final report sent ${hostedUrl}`,
									createdAt: "2026-10-01T10:00:00.000Z",
								},
							],
						},
					],
				},
				{ checkoutRoots: [checkout.root] },
				async (base) => {
					const response = await settledRead(new URL("/api/needs-you", base));
					const items = (await response.json()) as NeedsYouItem[];
					expect(items.map(({ key, reason }) => ({ key, reason }))).toEqual([
						{ key: "acme/widget#5", reason: "awaitingMerge" },
					]);
				},
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a factory run of the PR on the host does not reach the PR on github.com", async () => {
		const checkout = await devkitWorktree({
			key: "acme/widget#5",
			status: "running",
			mergeAuto: { merge: "yes" },
		});
		const [run] = hubRuns.runs;
		if (run === undefined) {
			throw new Error("the hub runs fixture lost a run");
		}
		const hostedRun = {
			...runDetail,
			pr: { owner: "acme", repo: "widget", number: 1, url: hostedUrl },
		};
		const factories = {
			[hubUrl]: { ...hub, [`/runs/${run.id}`]: hostedRun },
		};
		try {
			await withStoredRows(
				[widgetRow({ name: hostedKey, host, pulls: [homePull({})] })],
				{
					hosts,
					tracked: [hostedWidget],
					checkoutRoots: [checkout.root],
					factories: [{ name: "work hub", url: hubUrl }],
				},
				async (base) => {
					await readWhere<{ pull?: { url: string } }[]>(
						new URL("/api/factory-runs", base),
						(rows) => rows.some((row) => row.pull?.url === hostedUrl),
					);
					expect(await needsYouUrls(base)).toEqual([homeUrl]);
				},
				factoryFetch(factories, [], recordedFetch(200)),
			);
		} finally {
			await checkout.cleanup();
		}
	});
});

describe("an issue on github.com and a PR on a declared host with one number", () => {
	const openAsk: PullRequest["comments"][number] = {
		login: "agent",
		body: "This waits on Lev for the signing key.\n\n<!-- workcell:ask pr-1 -->",
		createdAt: "2026-10-01T00:00:00Z",
	};
	const issue = {
		number: 1,
		title: "Ticket 1",
		state: "open",
		state_reason: null,
		updated_at: "2026-10-02T00:00:00Z",
		html_url: "https://github.com/acme/widget/issues/1",
		body: "",
	};

	test("a comment on the issue does not notify as a comment on the PR", async () => {
		const recorded = {
			issues: [issue],
			pulls: [],
			checksBySha: {},
			commentsByIssue: {} as Record<number, Record<string, unknown>[]>,
			commentsByPull: {},
			reviewsByPull: {},
			reactionsByPull: {},
		};
		await withStoredRows(
			[
				widgetRow({
					tickets: [openTicket(1)],
					pulls: [storedPull(1, { host, comments: [openAsk] })],
				}),
			],
			{ hosts, tracked: [widget] },
			async (base) => {
				await settledOverview(base, readOverview<{ polling?: true }>);
				recorded.commentsByIssue[1] = [
					{
						id: 7001,
						body: "The key ships with the next build.",
						created_at: "2026-10-03T00:00:00Z",
						updated_at: "2026-10-03T00:00:00Z",
						user: { login: "ada" },
					},
				];
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await readWhere<{ tickets: { key: string; updatedAt?: string }[] }>(
					new URL("/api/projects/acme%2Fwidget", base),
					({ tickets }) =>
						tickets.some(
							(ticket) =>
								ticket.key === "acme/widget#1" &&
								ticket.updatedAt === issue.updated_at,
						),
				);
				await settledOverview(base, readOverview<{ polling?: true }>);
				const inbox = (await (
					await fetch(new URL("/api/inbox", base))
				).json()) as { trigger: string; host?: string }[];
				expect(inbox.filter((entry) => entry.host === host)).toEqual([]);
			},
			githubFetch(recorded),
			new Date(Date.now() - 60 * 1000),
		);
	});
});
