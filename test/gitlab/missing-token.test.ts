import { describe, expect, test } from "bun:test";

import type { Overview, ProjectReport } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { missingToken } from "../../src/github.ts";
import { missingGitlabToken } from "../../src/gitlab-forge.ts";
import { withServer } from "../support/app.ts";
import { json } from "../support/fetch.ts";
import { settledOverview } from "../support/reads.ts";
import {
	gitlabEnv,
	gitlabFake,
	gitlabRepo,
	linearName,
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
	return projects[0]?.error;
}

describe("a project that links a PR on a forge with no token", () => {
	test("keeps its tickets and its error across the next read", async () => {
		const sent: string[] = [];
		const linear = linearWithGitlab(
			[linkedTicket, linearTicket(2, [])],
			gitlabFake({ sent }),
		);
		let reads = 0;
		await withServer(
			(input, init) => {
				reads += 1;
				return linear(input, init);
			},
			3600,
			async (base) => {
				expect(await projectError(base)).toBe(missingGitlabToken);
				const report = (await (
					await fetch(
						new URL(
							`/api/projects/${encodeURIComponent(linearName)}?view=all`,
							base,
						),
					)
				).json()) as ProjectReport;
				expect(report.tickets.map((ticket) => ticket.key).sort()).toEqual([
					"WID-1",
					"WID-2",
				]);
				expect(sent).toEqual([]);
				const before = reads;
				await fetch(new URL("/api/refresh", base), { method: "POST" });
				while (reads === before) {
					await Bun.sleep(5);
				}
				await settledOverview(base, async (url) => {
					const response = await fetch(new URL("/api/overview", url));
					return (await response.json()) as { polling?: true };
				});
				expect(await projectError(base)).toBe(missingGitlabToken);
			},
			[linearPin],
			{ LINEAR_API_KEY: gitlabEnv.LINEAR_API_KEY },
		);
	});

	test("keeps the PRs of a forge that has a token", async () => {
		const github: Fetch = async () => json({ message: "not read" }, 500);
		await withServer(
			linearWithGitlab(
				[
					linkedTicket,
					linearTicket(2, ["https://github.com/acme/widget/pull/83"]),
				],
				gitlabFake(),
				github,
			),
			3600,
			async (base) => {
				expect(await projectError(base)).toBe(missingToken);
				expect(await ticketOf(base, "WID-1")).toMatchObject({
					state: "awaitingMerge",
					pull: `${gitlabRepo}!1`,
				});
				expect(await ticketOf(base, "WID-2")).toBeDefined();
			},
			[linearPin],
			gitlabEnv,
		);
	});
});
