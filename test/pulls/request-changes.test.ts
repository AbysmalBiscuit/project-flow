import { describe, expect, test } from "bun:test";

import type { Thread } from "../../src/domain.ts";
import { withApp } from "../project-harness.ts";
import { readWhere, settledRead } from "../support/reads.ts";
import {
	githubEnv,
	mergeFake,
	repo,
	sendRequestChanges,
	widgetConfig,
} from "./_support.ts";

const text = "Rename the flag before the merge.";

describe("request changes on an awaiting PR", () => {
	test("a Request changes sends a GitHub review with the REQUEST_CHANGES event and the text as its body", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const sent = await sendRequestChanges(base, text);
			expect(sent.status).toBe(204);
			expect(fake.reviews).toEqual([
				{
					url: `https://api.github.com/repos/${repo}/pulls/40/reviews`,
					body: { body: text, event: "REQUEST_CHANGES", commit_id: "sha-40" },
				},
			]);
			expect(fake.merges).toEqual([]);
		});
	});

	for (const blank of ["", "   \n\t"]) {
		test(`a text of ${JSON.stringify(blank)} is refused, and GitHub gets no request`, async () => {
			const fake = mergeFake();
			await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
				const sent = await sendRequestChanges(base, blank);
				expect(sent.status).toBe(400);
				expect(await sent.json()).toEqual({
					error: "The review text is empty",
				});
				expect(fake.reviews).toEqual([]);
			});
		});
	}

	test("a GitHub refusal of the review returns its reason", async () => {
		const fake = mergeFake({ refusesReview: true });
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const sent = await sendRequestChanges(base, text);
			expect(sent.status).toBe(422);
			expect(await sent.json()).toEqual({
				error: "Review Can not request changes on your own pull request",
			});
			expect(fake.reviews).toHaveLength(1);
		});
	});

	test("a Request changes on a PR that is not in Awaiting merge is refused, and GitHub gets no request", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const sent = await sendRequestChanges(
				base,
				text,
				`https://github.com/${repo}/pull/99`,
			);
			expect(sent.status).toBe(409);
			expect(await sent.json()).toEqual({
				error: "The PR is not in Awaiting merge",
			});
			expect(fake.reviews).toEqual([]);
		});
	});

	test("the PR thread shows the review after it is sent", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const threadUrl = new URL(
				`/api/threads/github/${encodeURIComponent(`${repo}#40`)}?project=${encodeURIComponent(repo)}`,
				base,
			);
			const before = (await (await settledRead(threadUrl)).json()) as Thread;
			expect(before.comments).toEqual([]);
			expect((await sendRequestChanges(base, text)).status).toBe(204);
			const after = await readWhere<Thread>(
				threadUrl,
				(thread) => thread.comments.length > 0,
			);
			expect(after.comments).toMatchObject([
				{
					body: text,
					author: "lev",
					createdAt: "2026-10-18T12:00:00Z",
					url: "https://github.com/acme/widget/pull/40#pullrequestreview-3348127710",
				},
			]);
		});
	});
});
