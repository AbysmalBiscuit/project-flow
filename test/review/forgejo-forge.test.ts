import { describe, expect, test } from "bun:test";

import type { NeedsYouItem, ProjectReport } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import branches from "../fixtures/forgejo-branches.json";
import openPulls from "../fixtures/forgejo-open-pulls.json";
import reviews10 from "../fixtures/forgejo-pull-10-reviews.json";
import status10 from "../fixtures/forgejo-pull-10-status.json";
import pull10 from "../fixtures/forgejo-pull-10.json";
import status11 from "../fixtures/forgejo-pull-11-status.json";
import status12 from "../fixtures/forgejo-pull-12-status.json";
import rejectedUser from "../fixtures/forgejo-user-401.json";
import { withApp } from "../project-harness.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { json, urlOf } from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";
import { readOverview } from "../support/reads.ts";

const host = "codeberg.org";
const tokenEnv = "CODEBERG_TOKEN";
const hosts = [{ host, forge: "forgejo", tokenEnv }];
const scratch = "AbysmalBiscuit/project-flow-scratch";
const repoApi = `https://${host}/api/v1/repos/${scratch}`;
const linearProject = "widget-launch-0d42ae5d46d0";

const env = {
	GITHUB_TOKEN: "recorded-token",
	LINEAR_API_KEY: "recorded-linear-key",
	[tokenEnv]: "recorded-codeberg-token",
};

const statusBySha = new Map(
	[status10, status11, status12].map((status) => [status.sha, status]),
);

type Sent = { url: string; authorization: string | null };

/** The recorded answers of the Codeberg scratch repo, or null for a URL on another host. */
function codeberg(url: string, userStatus: number): Response | null {
	if (!url.startsWith(`https://${host}/`)) {
		return null;
	}
	if (url === `https://${host}/api/v1/user`) {
		return userStatus === 401
			? json(rejectedUser, 401)
			: json({ login: "AbysmalBiscuit" });
	}
	const path = url.slice(repoApi.length);
	if (path === "/pulls/10") {
		return json(pull10);
	}
	if (path.startsWith("/pulls/10/reviews")) {
		return json(reviews10);
	}
	if (path.startsWith("/pulls?state=open")) {
		return json(openPulls);
	}
	if (path.startsWith("/branches")) {
		return json(branches);
	}
	const sha = path.match(/^\/commits\/([0-9a-f]{40})\/status/)?.[1];
	if (sha !== undefined) {
		return json(statusBySha.get(sha) ?? null, statusBySha.has(sha) ? 200 : 404);
	}
	if (
		path.startsWith("/pulls?state=closed") ||
		/^\/issues\/\d+\/comments/.test(path) ||
		/^\/pulls\/\d+\/reviews/.test(path)
	) {
		return json([]);
	}
	return new Response(`unrecorded: ${url}`, { status: 599 });
}

function attachedIssue(number: number, url: string) {
	return {
		identifier: `WID-${number}`,
		title: `Linear ticket ${number}`,
		updatedAt: "2026-10-01T00:00:00.000Z",
		state: { type: "unstarted" },
		attachments: {
			nodes: [{ url, title: `Link ${number}`, sourceType: null }],
		},
	};
}

function linearWithCodeberg(sent: Sent[], userStatus = 200): Fetch {
	const linear = linearFake({
		issues: [attachedIssue(8, `https://${host}/${scratch}/pulls/10`)],
		github: async (input) =>
			json(urlOf(input).includes("/check-runs") ? { check_runs: [] } : []),
	});
	return async (input, init) => {
		const url = urlOf(input);
		sent.push({
			url,
			authorization: new Headers(init?.headers).get("authorization"),
		});
		return codeberg(url, userStatus) ?? linear(input, init);
	};
}

async function attachedTicket(base: string) {
	const project = (await readOverview(base)).projects[0];
	const report = (await (
		await fetch(
			new URL(
				`/api/projects/${encodeURIComponent(project?.name ?? "")}?view=all`,
				base,
			),
		)
	).json()) as ProjectReport;
	const ticket = report.tickets.find((item) => item.key === "WID-8");
	return {
		error: project?.error ?? null,
		state: ticket?.state,
		pull: ticket?.pull,
		pullUrl: ticket?.pullUrl,
	};
}

describe("a Forgejo forge on a declared host", () => {
	test("a Linear ticket with a Codeberg attachment shows its PR and moves to In review", async () => {
		const sent: Sent[] = [];
		await withApp(
			JSON.stringify({
				hosts,
				tracked: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [`${host}/${scratch}`]: ["codex"] },
			}),
			linearWithCodeberg(sent),
			env,
			async (base) => {
				expect(await attachedTicket(base)).toEqual({
					error: null,
					state: "inReview",
					pull: `${scratch}#10`,
					pullUrl: `https://${host}/${scratch}/pulls/10`,
				});
				const reads = sent.filter(({ url }) => url.startsWith(repoApi));
				expect(reads.map(({ url }) => url)).toContain(`${repoApi}/pulls/10`);
				expect(
					reads.every(
						({ authorization }) => authorization === `token ${env[tokenEnv]}`,
					),
				).toBe(true);
			},
		);
	});

	test("a PR with passing checks and reviews moves its ticket to Awaiting merge", async () => {
		await withApp(
			JSON.stringify({
				hosts,
				tracked: [{ tracker: "linear", project: linearProject }],
			}),
			linearWithCodeberg([]),
			env,
			async (base) => {
				expect(await attachedTicket(base)).toMatchObject({
					error: null,
					state: "awaitingMerge",
					pull: `${scratch}#10`,
				});
				const items = (await (
					await fetch(new URL("/api/needs-you", base))
				).json()) as NeedsYouItem[];
				expect(items.find((item) => item.key === "WID-8")?.pull).toEqual({
					number: 10,
					title: pull10.title,
					url: pull10.html_url,
					ci: "passing",
					review: "pending",
				});
			},
		);
	});
});

describe("the token of a declared Forgejo host", () => {
	test("a missing token names its env var on each project of the host", async () => {
		const sent: Sent[] = [];
		const { [tokenEnv]: _token, ...withoutToken } = env;
		await withApp(
			JSON.stringify({
				hosts,
				tracked: [{ tracker: "github", repo: scratch, host }],
			}),
			linearWithCodeberg(sent),
			withoutToken,
			async (base) => {
				const project = (await readOverview(base)).projects[0];
				expect(project?.error).toBe(
					`${tokenEnv} is missing: set ${tokenEnv} to read ${host}.`,
				);
				expect(sent.some(({ url }) => url.startsWith(`https://${host}/`))).toBe(
					false,
				);
			},
		);
	});

	test("a rejected token stops the start and names its env var", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				hosts,
				tracked: [{ tracker: "linear", project: linearProject }],
			}),
		);
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { ...env, [tokenEnv]: "rejected-token" },
					fetch: linearWithCodeberg([], 401),
					readGhToken: async () => null,
					databasePath: ":memory:",
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				`${tokenEnv} was rejected by ${host} (HTTP 401): set a valid token.`,
			);
		} finally {
			await cleanup();
		}
	});
});
