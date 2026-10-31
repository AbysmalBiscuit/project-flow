import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteStore } from "../../src/store.ts";
import { githubFetch } from "../review-github-fake.ts";
import {
	readOverview,
	readWhere,
	settledOverview,
	settledRead,
} from "../support/reads.ts";
import {
	host,
	hosts,
	recordingFetch,
	storedPull,
	widget,
	widgetRow,
	withStarted,
	withStoredRows,
} from "./_support.ts";

const key = "acme/widget#1";
const homeProject = "acme/widget";

describe("a PR on a declared host in a project on github.com", () => {
	const sent: { url: string; authorization: string | null }[] = [];
	const hosted = storedPull(1, { host });

	function withHostedPull(
		checks: (base: string) => Promise<void>,
	): Promise<void> {
		return withStoredRows(
			[widgetRow({ pulls: [hosted] })],
			{ hosts, tracked: [widget] },
			async (base) => {
				await settledOverview(base, readOverview<{ polling?: true }>);
				await checks(base);
			},
			recordingFetch(sent),
		);
	}

	test("a thread read of the PR does not reach the home tracker", async () => {
		await withHostedPull(async (base) => {
			const asked = sent.length;
			const url = new URL(
				`/api/threads/github/${encodeURIComponent(key)}`,
				base,
			);
			url.searchParams.set("project", homeProject);
			url.searchParams.set("host", host);
			const response = await settledRead(url);
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ missing: true });
			expect(sent.slice(asked)).toEqual([]);
		});
	});

	test("a reply to the PR does not reach the home tracker", async () => {
		await withHostedPull(async (base) => {
			const asked = sent.length;
			const response = await fetch(new URL("/api/replies", base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: homeProject,
					key,
					host,
					body: "Done.",
				}),
			});
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: "tracker unavailable" });
			expect(sent.slice(asked)).toEqual([]);
		});
	});

	test("the inbox keeps the host of the PR across a restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-hosts-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = sqliteStore(databasePath);
		const row = widgetRow({
			pulls: [
				storedPull(1, {
					host,
					branch: "5-change",
					comments: [
						{
							login: "agent",
							body: "This waits on Lev for the signing key.\n\n<!-- workcell:ask pr-1 -->",
							createdAt: "2026-10-01T00:00:00Z",
						},
					],
				}),
			],
		});
		seeded.store.mergeTickets([row]);
		seeded.store.recordGoodPoll(
			{ kind: "github-repo", tracker: "github", key: homeProject },
			new Date(Date.now() - 60 * 1000),
		);
		seeded.close();
		const issues: Record<string, unknown>[] = [];
		const github = githubFetch({
			issues,
			pulls: [],
			checksBySha: {},
			commentsByPull: {},
			reviewsByPull: {},
			reactionsByPull: {},
		});
		const configuration = { hosts, tracked: [widget] };
		const inboxOf = (base: string) =>
			readWhere<{ trigger: string; key: string; host?: string }[]>(
				new URL("/api/inbox", base),
				(entries) => entries.length > 0,
			);
		const expected = { trigger: "needsYou", key, host };
		try {
			await withStarted(
				configuration,
				async (base) => {
					await settledOverview(base, readOverview<{ polling?: true }>);
					issues.push({
						number: 5,
						title: "Ticket 5",
						state: "closed",
						state_reason: "completed",
						html_url: "https://github.com/acme/widget/issues/5",
						updated_at: "2026-10-02T00:00:00Z",
					});
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					expect(await inboxOf(base)).toMatchObject([expected]);
				},
				github,
				databasePath,
			);
			await withStarted(
				configuration,
				async (base) => {
					expect(await inboxOf(base)).toMatchObject([expected]);
				},
				github,
				databasePath,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
