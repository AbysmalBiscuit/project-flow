import { describe, expect, test } from "bun:test";

import { withApp } from "../project-harness.ts";
import {
	type CommitStatus,
	githubEnv,
	linearConfig,
	linearEnv,
	linearMergeFake,
	mergeFake,
	passedCheck,
	readTicket,
	repo,
	sendMerge,
	widgetConfig,
} from "./_support.ts";

const refused: { state: string; reason: string; ci: string }[] = [
	{ state: "pending", reason: "A check is pending", ci: "pending" },
	{ state: "failure", reason: "A check failed", ci: "failing" },
	{ state: "error", reason: "A check failed", ci: "failing" },
];

async function readCi(base: string, key: string): Promise<string | undefined> {
	const needs = (await (
		await fetch(new URL("/api/needs-you", base))
	).json()) as { key: string; pull?: { ci: string } }[];
	return needs.find((item) => item.key === key)?.pull?.ci;
}

const status = (state: string): CommitStatus => ({ context: "deploy", state });

describe("commit statuses close the merge gate", () => {
	for (const { state, reason, ci } of refused) {
		test(`commit status ${state} beside a passing check run refuses a merge on a repo read`, async () => {
			const fake = mergeFake({ statuses: [status(state)] });
			await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
				const sent = await sendMerge(base);
				expect(sent.status).toBe(409);
				expect(await sent.json()).toEqual({ error: reason });
				expect(fake.merges).toEqual([]);
				expect(await readCi(base, `${repo}#8`)).toBe(ci);
			});
		});

		test(`commit status ${state} beside a passing check run refuses a merge on a linked PR read`, async () => {
			const fake = linearMergeFake({
				checkPages: [[passedCheck]],
				statuses: [status(state)],
			});
			await withApp(linearConfig, fake.fetch, linearEnv, async (base) => {
				const sent = await sendMerge(base, fake.pull.html_url);
				expect(sent.status).toBe(409);
				expect(await sent.json()).toEqual({ error: reason });
				expect(fake.merges).toEqual([]);
				expect(await readCi(base, "SWE-13029")).toBe(ci);
			});
		});
	}

	test("a successful commit status passes the gate on both reads", async () => {
		const github = mergeFake({ statuses: [status("success")] });
		await withApp(widgetConfig, github.fetch, githubEnv, async (base) => {
			expect(
				(await readTicket(base, repo, `${repo}#8`))?.awaitingPulls?.[0]
					?.mergeGate,
			).toEqual({ open: true });
			expect((await sendMerge(base)).status).toBe(204);
		});
		const linear = linearMergeFake({ statuses: [status("success")] });
		await withApp(linearConfig, linear.fetch, linearEnv, async (base) => {
			expect((await sendMerge(base, linear.pull.html_url)).status).toBe(204);
		});
	});
});
