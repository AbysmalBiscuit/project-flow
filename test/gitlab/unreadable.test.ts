import { describe, expect, test } from "bun:test";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { withServer } from "../support/app.ts";
import { json, urlOf } from "../support/fetch.ts";
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

async function projectError(base: string) {
	const { projects } = (await (
		await fetch(new URL("/api/overview", base))
	).json()) as Overview;
	return projects[0]?.error ?? null;
}

/** Asks for a poll, and waits until the app sent a request and settled. */
async function refreshed(base: string, reads: () => number) {
	const before = reads();
	await fetch(new URL("/api/refresh", base), { method: "POST" });
	while (reads() === before) {
		await Bun.sleep(5);
	}
	await settledOverview(base, async (url) => {
		const response = await fetch(new URL("/api/overview", url));
		return (await response.json()) as { polling?: true };
	});
}

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
						pull: `${gitlabRepo}!1`,
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

describe("a GitLab read that fails for another reason than a missing PR", () => {
	test.each([401, 500])(
		"HTTP %p marks the project, keeps its stored PRs and clears on the next good read",
		async (status) => {
			const recorded = gitlabFake();
			let failing = false;
			let reads = 0;
			const gitlab: Fetch = (input, init) =>
				failing && urlOf(input).includes("/projects/")
					? Promise.resolve(json({ message: "failed" }, status))
					: recorded(input, init);
			const linear = linearWithGitlab([linkedTicket], gitlab);
			await withServer(
				(input, init) => {
					reads += 1;
					return linear(input, init);
				},
				3600,
				async (base) => {
					const linked = { state: "awaitingMerge", pull: `${gitlabRepo}!1` };
					expect(await ticketOf(base, "WID-1")).toMatchObject(linked);
					failing = true;
					await refreshed(base, () => reads);
					expect(await projectError(base)).toContain(`HTTP ${status}`);
					expect(await ticketOf(base, "WID-1")).toMatchObject(linked);
					failing = false;
					await refreshed(base, () => reads);
					expect(await projectError(base)).toBeNull();
					expect(await ticketOf(base, "WID-1")).toMatchObject(linked);
				},
				[linearPin],
				gitlabEnv,
			);
		},
	);
});
