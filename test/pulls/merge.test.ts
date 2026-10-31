import { describe, expect, test } from "bun:test";

import { withApp } from "../project-harness.ts";
import {
	type ChangeEvent,
	openEventStream,
	overviewOf,
} from "../support/reads.ts";
import {
	githubEnv,
	linearConfig,
	linearEnv,
	linearMergeFake,
	mergeFake,
	passedCheck,
	pullUrl,
	readTicket,
	repo,
	sendMerge,
	widgetConfig,
} from "./_support.ts";

const ticketKey = `${repo}#8`;

const openQuestionBody = `Closes #8

### Important Questions

<details><summary><b>1. redefines the scope:</b> Should the widget ship?</summary>

The widget changes its scope.

</details>
`;

async function waitForDone(events: AsyncIterable<ChangeEvent>): Promise<void> {
	for await (const event of events) {
		const shown = overviewOf(event.data).projects[0]?.tickets.find(
			(ticket) => ticket.key === ticketKey,
		);
		if (shown?.state === "done") {
			return;
		}
	}
}

const refused = [
	{
		name: "a pending check",
		fake: {
			checks: [{ name: "ci", status: "in_progress", conclusion: null }],
		},
		reason: "A check is pending",
		ci: "pending",
	},
	{
		name: "a failed check",
		fake: {
			checks: [
				passedCheck,
				{ name: "lint", status: "completed", conclusion: "failure" },
			],
		},
		reason: "A check failed",
		ci: "failing",
	},
	{
		name: "a check that ended with action required",
		fake: {
			checks: [
				passedCheck,
				{ name: "deploy", status: "completed", conclusion: "action_required" },
			],
		},
		reason: "A check failed",
		ci: "failing",
	},
	{
		name: "a stale check",
		fake: {
			checks: [
				passedCheck,
				{ name: "deploy", status: "completed", conclusion: "stale" },
			],
		},
		reason: "A check failed",
		ci: "failing",
	},
	{
		name: "a check that failed to start",
		fake: {
			checks: [
				passedCheck,
				{ name: "deploy", status: "completed", conclusion: "startup_failure" },
			],
		},
		reason: "A check failed",
		ci: "failing",
	},
	{
		name: "an open Important Question",
		fake: { body: openQuestionBody },
		reason: "An Important Question is open",
		ci: "passing",
	},
];

describe("merge an awaiting PR", () => {
	test("a merge that passes the gate sends a squash merge and takes the ticket out of Awaiting merge", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const before = await readTicket(base, repo, ticketKey);
			expect(before?.state).toBe("awaitingMerge");
			const stream = openEventStream(base);
			await stream.ready;
			try {
				const sent = await sendMerge(base);
				expect(sent.status).toBe(204);
				expect(fake.merges).toEqual([
					{
						url: `https://api.github.com/repos/${repo}/pulls/40/merge`,
						method: "PUT",
						authorization: "Bearer recorded-token",
						body: { merge_method: "squash", sha: "sha-40" },
					},
				]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as {
					projects: { tickets: { key: string; state: string }[] }[];
				};
				const shown = overview.projects[0]?.tickets.find(
					(ticket) => ticket.key === ticketKey,
				);
				expect(shown?.state).toBe("done");
				await waitForDone(stream.events);
			} finally {
				stream.close();
			}
			const after = await readTicket(base, repo, ticketKey);
			expect(after?.awaitingPulls).toBeUndefined();
		});
	});

	test("skipped and neutral checks pass the gate", async () => {
		const fake = mergeFake({
			checks: [
				passedCheck,
				{ name: "docs", status: "completed", conclusion: "skipped" },
				{ name: "note", status: "completed", conclusion: "neutral" },
			],
		});
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			expect((await sendMerge(base)).status).toBe(204);
			expect(fake.merges).toHaveLength(1);
		});
	});

	for (const { name, fake: answers, reason, ci } of refused) {
		test(`a merge with ${name} is refused with its reason, and GitHub gets no request`, async () => {
			const fake = mergeFake(answers);
			await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
				const sent = await sendMerge(base);
				expect(sent.status).toBe(409);
				expect(await sent.json()).toEqual({ error: reason });
				expect(fake.merges).toEqual([]);
				expect(
					(await readTicket(base, repo, ticketKey))?.awaitingPulls?.[0]
						?.mergeGate,
				).toEqual({ open: false, reason });
				const needs = (await (
					await fetch(new URL("/api/needs-you", base))
				).json()) as { key: string; pull?: { ci: string } }[];
				expect(needs.find((item) => item.key === ticketKey)?.pull?.ci).toBe(ci);
			});
		});
	}

	test("a merge of a PR that is not in Awaiting merge is refused, and GitHub gets no request", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const sent = await sendMerge(base, `https://github.com/${repo}/pull/999`);
			expect(sent.status).toBe(409);
			expect(await sent.json()).toEqual({
				error: "The PR is not in Awaiting merge",
			});
			expect(fake.merges).toEqual([]);
		});
	});

	test("a second merge after the first one is refused, and GitHub gets one request", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			expect((await sendMerge(base)).status).toBe(204);
			expect((await sendMerge(base)).status).toBe(409);
			expect(fake.merges).toHaveLength(1);
		});
	});

	test("a GitHub refusal returns its reason and leaves the store as it was", async () => {
		const fake = mergeFake({ refuses: true });
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const before = await readTicket(base, repo, ticketKey);
			const reads = fake.repoReads();
			const sent = await sendMerge(base);
			expect(sent.status).toBe(405);
			expect(await sent.json()).toEqual({
				error: "Pull Request is not mergeable",
			});
			expect(fake.merges).toHaveLength(1);
			expect(fake.repoReads()).toBe(reads);
			expect(await readTicket(base, repo, ticketKey)).toEqual(before);
		});
	});

	test("the PR of a Linear ticket merges through the GitHub forge", async () => {
		const { fetch: fetchImpl, merges, pull } = linearMergeFake();
		await withApp(linearConfig, fetchImpl, linearEnv, async (base) => {
			const before = await readTicket(base, "Widget launch", "SWE-13029");
			expect(before?.state).toBe("awaitingMerge");
			expect(before?.awaitingPulls?.[0]).toMatchObject({
				url: pull.html_url,
				baseBranch: pull.base.ref,
				actions: ["merge"],
			});
			const sent = await sendMerge(base, pull.html_url);
			expect(sent.status).toBe(204);
			expect(merges).toEqual([
				{
					url: `https://api.github.com/repos/${pull.repo}/pulls/206/merge`,
					body: { merge_method: "squash", sha: pull.head.sha },
				},
			]);
			const after = await readTicket(base, "Widget launch", "SWE-13029");
			expect(after?.state).not.toBe("awaitingMerge");
		});
	});

	test("each awaiting PR lists its actions and its gate state", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const ticket = await readTicket(base, repo, ticketKey);
			expect(ticket?.awaitingPulls).toEqual([
				{
					repo,
					number: 40,
					title: "Ship the widget",
					url: pullUrl,
					baseBranch: "main",
					headSha: "sha-40",
					actions: ["merge"],
					mergeGate: { open: true },
				},
			]);
		});
	});

	test("a PR in review lists no actions, and a merge of it is refused", async () => {
		const fake = mergeFake();
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pmBot: { [repo]: false },
				expectedBots: { [repo]: ["greptile"] },
			}),
			fake.fetch,
			githubEnv,
			async (base) => {
				const ticket = await readTicket(base, repo, ticketKey);
				expect(ticket?.state).toBe("inReview");
				expect(ticket?.awaitingPulls).toBeUndefined();
				expect((await sendMerge(base)).status).toBe(409);
				expect(fake.merges).toEqual([]);
			},
		);
	});
});
