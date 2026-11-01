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

const notAwaiting = { error: "The PR is not in Awaiting merge" };

const status = (state: string): CommitStatus => ({ context: "deploy", state });

describe("commit statuses close the merge gate", () => {
	for (const state of ["pending", "failure", "error"]) {
		test(`commit status ${state} beside a passing check run refuses a merge on a repo read`, async () => {
			const fake = mergeFake({ statuses: [status(state)] });
			await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
				expect((await readTicket(base, repo, `${repo}#8`))?.state).not.toBe(
					"awaitingMerge",
				);
				const sent = await sendMerge(base);
				expect(sent.status).toBe(409);
				expect(await sent.json()).toEqual(notAwaiting);
				expect(fake.merges).toEqual([]);
			});
		});

		test(`commit status ${state} beside a passing check run refuses a merge on a linked PR read`, async () => {
			const fake = linearMergeFake({
				checkPages: [[passedCheck]],
				statuses: [status(state)],
			});
			await withApp(linearConfig, fake.fetch, linearEnv, async (base) => {
				expect(
					(await readTicket(base, "Widget launch", "SWE-13029"))?.state,
				).not.toBe("awaitingMerge");
				const sent = await sendMerge(base, fake.pull.html_url);
				expect(sent.status).toBe(409);
				expect(await sent.json()).toEqual(notAwaiting);
				expect(fake.merges).toEqual([]);
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
