import { describe, expect, test } from "bun:test";

import type { Fetch } from "../../src/fetch.ts";
import { githubFetch } from "../review-github-fake.ts";
import { codex } from "../review/_support.ts";
import { readWhere } from "../support/reads.ts";
import {
	host,
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
