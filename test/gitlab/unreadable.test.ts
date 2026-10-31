import { describe, expect, test } from "bun:test";

import { withServer } from "../support/app.ts";
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

describe("a Linear ticket that links a GitLab PR the token cannot read", () => {
	test.each([
		["a missing PR", gitlabPullUrl(999)],
		[
			"a PR of an unreadable repo",
			"https://gitlab.com/AbysmalBiscuit/no-access/-/merge_requests/1",
		],
	])(
		"%s leaves the readable PRs and tickets of the project",
		async (_, url) => {
			await withServer(
				linearWithGitlab([linkedTicket, linearTicket(2, [url])], gitlabFake()),
				3600,
				async (base) => {
					expect(await ticketOf(base, "WID-1")).toMatchObject({
						state: "awaitingMerge",
						pull: `${gitlabRepo}#1`,
					});
					const unread = await ticketOf(base, "WID-2");
					expect(unread).toBeDefined();
					expect(unread).not.toHaveProperty("pull");
				},
				[linearPin],
				gitlabEnv,
			);
		},
	);
});
