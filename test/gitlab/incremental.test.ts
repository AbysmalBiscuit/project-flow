import { expect, test } from "bun:test";

import { withServer } from "../support/app.ts";
import { settledOverview } from "../support/reads.ts";
import {
	gitlabEnv,
	gitlabFake,
	gitlabPullUrl,
	gitlabRepo,
	linearPin,
	linearTicket,
	linearWithGitlab,
	linkedTicket,
	ticketOf,
} from "./_support.ts";

test("an incremental poll that leaves out a ticket keeps its link to a PR of the listed repo", async () => {
	const changed = linearTicket(2, [gitlabPullUrl(2)]);
	const issues: Record<string, unknown>[] = [linkedTicket, changed];
	const sent: string[] = [];
	await withServer(
		linearWithGitlab(issues, gitlabFake({ sent })),
		3600,
		async (base) => {
			expect(await ticketOf(base, "WID-1")).toMatchObject({
				state: "awaitingMerge",
				pull: `${gitlabRepo}#1`,
			});
			issues.splice(0, issues.length, changed);
			const before = sent.length;
			await fetch(new URL("/api/refresh", base), { method: "POST" });
			while (sent.length === before) {
				await Bun.sleep(5);
			}
			await settledOverview(base, async (url) => {
				const response = await fetch(new URL("/api/overview", url));
				return (await response.json()) as { polling?: true };
			});
			expect(await ticketOf(base, "WID-1")).toMatchObject({
				state: "awaitingMerge",
				pull: `${gitlabRepo}#1`,
			});
			expect(await ticketOf(base, `${gitlabRepo}#1`)).toBeUndefined();
		},
		[linearPin],
		gitlabEnv,
	);
});
