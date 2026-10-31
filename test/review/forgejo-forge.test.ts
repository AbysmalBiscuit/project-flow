import { describe, expect, test } from "bun:test";

import type { NeedsYouItem, ProjectReport } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import branches from "../fixtures/forgejo-branches.json";
import commit10 from "../fixtures/forgejo-commit-10.json";
import openPulls from "../fixtures/forgejo-open-pulls.json";
import reactions10 from "../fixtures/forgejo-pull-10-reactions.json";
import reviews10 from "../fixtures/forgejo-pull-10-reviews.json";
import status10 from "../fixtures/forgejo-pull-10-status.json";
import pull10 from "../fixtures/forgejo-pull-10.json";
import status11 from "../fixtures/forgejo-pull-11-status.json";
import status12 from "../fixtures/forgejo-pull-12-status.json";
import rejectedUser from "../fixtures/forgejo-user-401.json";
import { withApp } from "../project-harness.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { json, urlOf } from "../support/fetch.ts";
import {
	codex,
	page,
	recordedDiscovery,
	recordedOrEmpty,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { readOverview } from "../support/reads.ts";
import { grok } from "./_support.ts";

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

type Codeberg = {
	userStatus?: number;
	/** Answers that replace the recorded answer of a repo path, by the start of the path. */
	answers?: Record<string, () => Response>;
};

const rejected = () => json(rejectedUser, 401);

/** The recorded answers of the Codeberg scratch repo, or null for a URL on another host. */
function codeberg(url: string, options: Codeberg): Response | null {
	if (!url.startsWith(`https://${host}/`)) {
		return null;
	}
	if (url === `https://${host}/api/v1/user`) {
		return options.userStatus === 401
			? rejected()
			: json({ login: "AbysmalBiscuit" });
	}
	const path = url.slice(repoApi.length);
	const answer = Object.entries(options.answers ?? {}).find(([start]) =>
		path.startsWith(start),
	)?.[1];
	if (answer !== undefined) {
		return answer();
	}
	if (path.startsWith("/issues/10/reactions")) {
		return json(reactions10);
	}
	if (path.startsWith(`/git/commits/${commit10.sha}`)) {
		return json(commit10);
	}
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

function linearWithCodeberg(
	sent: Sent[],
	options: Codeberg = {},
	issues = [attachedIssue(8, `https://${host}/${scratch}/pulls/10`)],
): Fetch {
	const linear = linearFake({
		issues,
		github: async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return page({ login: "lev" });
			}
			if (url.includes("/repos/acme/widget/issues?")) {
				return page([]);
			}
			return (
				recordedDiscovery(input, init) ??
				recordedOrEmpty(url) ??
				unrecorded(input)
			);
		},
	});
	return async (input, init) => {
		const url = urlOf(input);
		sent.push({
			url,
			authorization: new Headers(init?.headers).get("authorization"),
		});
		return codeberg(url, options) ?? linear(input, init);
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
					fetch: linearWithCodeberg([], { userStatus: 401 }),
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

const linearOnCodeberg = JSON.stringify({
	hosts,
	tracked: [{ tracker: "linear", project: linearProject }],
});

/** A GitHub project beside the Linear project, so that a failed Linear read does not stop a cold start. */
const linearBesideGithub = JSON.stringify({
	hosts,
	tracked: [
		{ tracker: "linear", project: linearProject },
		{ tracker: "github", repo: "acme/widget" },
	],
});

async function projectError(base: string) {
	const { projects } = await readOverview(base);
	return (
		projects.find((project) => project.tracker === "linear")?.error ?? null
	);
}

describe("a Linear project with a Codeberg attachment", () => {
	test("with no token for the host names its env var beside the tickets", async () => {
		const sent: Sent[] = [];
		const { [tokenEnv]: _token, ...withoutToken } = env;
		await withApp(
			linearOnCodeberg,
			linearWithCodeberg(sent),
			withoutToken,
			async (base) => {
				const ticket = await attachedTicket(base);
				expect(ticket.state).toBe("backlog");
				expect(ticket.error).toBe(
					`${tokenEnv} is missing: set ${tokenEnv} to read ${host}.`,
				);
				expect(sent.some(({ url }) => url.startsWith(`https://${host}/`))).toBe(
					false,
				);
			},
		);
	});

	for (const [read, path] of [
		["the PR", "/pulls/10"],
		["the statuses", `/commits/${pull10.head.sha}/status`],
	] as const) {
		test(`whose token the host rejects on ${read} names its env var on the project`, async () => {
			await withApp(
				linearBesideGithub,
				linearWithCodeberg([], { answers: { [path]: rejected } }),
				env,
				async (base) => {
					expect(await projectError(base)).toBe(
						`${tokenEnv} was rejected by ${host} (HTTP 401): set a valid token.`,
					);
				},
			);
		});
	}
});

describe("a Linear project with links to several hosts", () => {
	test("skips the link of a declared host that no forge reads and keeps the tickets", async () => {
		const acme = "git.acme.dev";
		await withApp(
			JSON.stringify({
				hosts: [
					...hosts,
					{ host: acme, forge: "github", tokenEnv: "ACME_TOKEN" },
				],
				tracked: [{ tracker: "linear", project: linearProject }],
			}),
			linearWithCodeberg([], {}, [
				attachedIssue(8, `https://${host}/${scratch}/pulls/10`),
				attachedIssue(9, `https://${acme}/acme/widget/pull/3`),
			]),
			{ ...env, ACME_TOKEN: "recorded-acme-token" },
			async (base) => {
				expect(await attachedTicket(base)).toEqual({
					error: null,
					state: "awaitingMerge",
					pull: `${scratch}#10`,
					pullUrl: `https://${host}/${scratch}/pulls/10`,
				});
			},
		);
	});
});

describe("a Forgejo page link to another origin", () => {
	test("sends no request to that origin and leaves the PR out", async () => {
		const sent: Sent[] = [];
		const foreign = "https://evil.example/next";
		await withApp(
			linearOnCodeberg,
			linearWithCodeberg(sent, {
				answers: {
					"/pulls/10/reviews": () =>
						json(reviews10, 200, { link: `<${foreign}>; rel="next"` }),
				},
			}),
			env,
			async (base) => {
				expect((await attachedTicket(base)).pull).toBeUndefined();
				expect(
					sent.some(({ url }) => url.startsWith("https://evil.example")),
				).toBe(false);
			},
		);
	});
});

describe("the expected bots of a Codeberg PR", () => {
	const withBots = (bots: string[]) =>
		JSON.stringify({
			hosts,
			tracked: [{ tracker: "linear", project: linearProject }],
			expectedBots: { [`${host}/${scratch}`]: bots },
		});

	test("a Codex reaction on the PR completes the Codex review", async () => {
		const reaction = {
			user: { login: codex },
			content: "+1",
			created_at: "2026-10-30T17:00:00+01:00",
		};
		await withApp(
			withBots(["codex"]),
			linearWithCodeberg([], {
				answers: { "/issues/10/reactions": () => json([reaction]) },
			}),
			env,
			async (base) => {
				expect(await attachedTicket(base)).toMatchObject({
					error: null,
					state: "awaitingMerge",
				});
			},
		);
	});

	test("a Grok usage limit after the head commit ends the Grok review with a tag", async () => {
		const limitAt = (createdAt: string) => () =>
			json([
				{
					user: { login: grok },
					body: "You have reached your Grok usage limit for code reviews.",
					created_at: createdAt,
				},
			]);
		const read = async (createdAt: string) => {
			let shown: { state: unknown; tags: unknown } | undefined;
			await withApp(
				withBots(["grok"]),
				linearWithCodeberg([], {
					answers: { "/issues/10/comments": limitAt(createdAt) },
				}),
				env,
				async (base) => {
					const project = (await readOverview(base)).projects[0];
					shown = {
						state: (await attachedTicket(base)).state,
						tags: (project as { tags?: unknown } | undefined)?.tags,
					};
				},
			);
			return shown;
		};
		expect(await read("2026-10-30T17:00:00+01:00")).toEqual({
			state: "awaitingMerge",
			tags: ["grok usage limit"],
		});
		expect(await read("2026-10-30T16:00:00+01:00")).toEqual({
			state: "inReview",
			tags: [],
		});
	});
});
