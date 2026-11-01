import { describe, expect, test } from "bun:test";

import { withApp } from "../project-harness.ts";
import {
	githubEnv,
	mergeFake,
	passedCheck,
	pullUrl,
	readTicket,
	repo,
	sendMerge,
	widgetConfig,
} from "./_support.ts";

const key = `${repo}#40`;
const unlinked = { body: "No linked ticket", branch: "ship-widget" };

describe("merge an unlinked awaiting PR", () => {
	test("the card lists the merge action, and a merge sends a squash merge and takes it out of Awaiting merge", async () => {
		const fake = mergeFake(unlinked);
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const card = await readTicket(base, repo, key);
			expect(card?.unlinkedPr).toBe(true);
			expect(card?.awaitingPulls).toMatchObject([
				{
					url: pullUrl,
					actions: ["merge", "requestChanges"],
					mergeGate: { open: true },
				},
			]);
			const sent = await sendMerge(base);
			expect(sent.status).toBe(204);
			expect(fake.merges).toMatchObject([
				{
					url: `https://api.github.com/repos/${repo}/pulls/40/merge`,
					body: { merge_method: "squash" },
				},
			]);
			expect(
				(await readTicket(base, repo, key))?.awaitingPulls,
			).toBeUndefined();
		});
	});

	test("a failed check keeps the PR out of Awaiting merge, and GitHub gets no request", async () => {
		const fake = mergeFake({
			...unlinked,
			checks: [
				passedCheck,
				{ name: "e2e", status: "completed", conclusion: "failure" },
			],
		});
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const card = await readTicket(base, repo, key);
			expect(card?.state).not.toBe("awaitingMerge");
			expect(card?.awaitingPulls).toBeUndefined();
			const sent = await sendMerge(base);
			expect(sent.status).toBe(409);
			expect(await sent.json()).toEqual({
				error: "The PR is not in Awaiting merge",
			});
			expect(fake.merges).toEqual([]);
		});
	});
});
