import { describe, expect, test } from "bun:test";

import type { NeedsYouItem, PullRequest, Snapshot } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { githubFetch } from "../review-github-fake.ts";
import { codex } from "../review/_support.ts";
import { devkitWorktree } from "../support/checkouts.ts";
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
});
