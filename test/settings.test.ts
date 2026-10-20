import { describe, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Configuration } from "../src/configuration.ts";
import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import type { LocalCheckout } from "../src/ports.ts";
import {
	emptyProjectFields,
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const shown = "acme/shown";
const quiet = "acme/quiet";

function issue(
	number: number,
	updatedAt: string,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: state === "closed" ? "completed" : null,
		html_url: `https://github.com/${shown}/issues/${number}`,
		updated_at: updatedAt,
		body: "",
	};
}

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function recordTracker(
	requests: string[],
	input: string | URL | Request,
): void {
	const url = urlOf(input);
	if (
		url.startsWith("https://api.github.com/") ||
		url.startsWith("https://api.linear.app/")
	) {
		requests.push(url);
	}
}

function recorded(
	requests: string[],
	input: string | URL | Request,
	init?: RequestInit,
): Response {
	recordTracker(requests, input);
	const url = urlOf(input);
	if (url.startsWith("https://api.github.com/user/repos")) {
		return new Response(
			JSON.stringify([
				{
					full_name: shown,
					owner: { login: "lev" },
					permissions: { push: true },
					pushed_at: "2026-08-01T12:00:00.000Z",
				},
				{
					full_name: quiet,
					owner: { login: "lev" },
					permissions: { push: true },
					pushed_at: "2026-01-01T12:00:00.000Z",
				},
			]),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	if (url === "https://api.github.com/user") {
		return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
	}
	const match = url.match(
		/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?/,
	);
	if (match?.[1] === shown) {
		return page([issue(1, "2026-08-01T12:00:00.000Z")]);
	}
	if (match?.[1] === quiet) {
		return page([issue(1, "2026-01-01T12:00:00.000Z")]);
	}
	if (match?.[1] === savedRepo) {
		return page([issue(7, "2026-08-10T12:00:00.000Z")]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		/\/pulls\/\d+$/.test(url)
	) {
		return page([]);
	}
	if (url.includes("/check-runs")) {
		return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("ProjectByNumber")) {
			return new Response(
				JSON.stringify({
					data: {
						repositoryOwner: {
							projectV2: {
								id: "PVT_acme_7",
								number: 7,
								title: "Acme board",
								closed: false,
								updatedAt: "2026-01-01T12:00:00Z",
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (body.includes("node(id:")) {
			return new Response(
				JSON.stringify({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											number: 1,
											state: "OPEN",
											stateReason: null,
											repository: { nameWithOwner: "acme/other" },
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (body.includes("ViewerProjects") || body.includes("OrgProjects")) {
			return new Response(
				JSON.stringify({
					data: {
						viewer: {
							login: "lev",
							projectsV2: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
							organizations: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
						organization: {
							projectsV2: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200 },
			);
		}
		return new Response(
			JSON.stringify({
				data: {
					repository: {
						pullRequest: { closingIssuesReferences: { nodes: [] } },
					},
				},
			}),
			{ status: 200 },
		);
	}
	if (url === "https://api.linear.app/graphql") {
		return new Response(
			JSON.stringify({
				data: {
					viewer: { id: "lev" },
					projects: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	return unrecorded(input);
}

function fetching(requests: string[]): Fetch {
	return async (input, init) => recorded(requests, input, init);
}

const reviewHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function openReviewPull(repo: string): Record<string, unknown> {
	return {
		number: 2,
		title: "Review me",
		state: "open",
		draft: false,
		html_url: `https://github.com/${repo}/pull/2`,
		head: { ref: "2-feat-review", sha: reviewHead },
		body: "Closes #1",
		merged_at: null,
	};
}

function mergedBotPull(repo: string): Record<string, unknown> {
	return {
		number: 1,
		title: "merged",
		state: "closed",
		draft: false,
		html_url: `https://github.com/${repo}/pull/1`,
		head: { ref: "1-merged", sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
		body: "",
		merged_at: "2026-08-01T00:00:00Z",
		user: { login: "lev" },
	};
}

function fetchingBots(requests: string[], orphan = false): Fetch {
	if (orphan) {
		return async (input, init) => {
			recordTracker(requests, input);
			if (urlOf(input) !== "https://api.linear.app/graphql") {
				return recordedBots(requests, input, init);
			}
			return new Response(
				JSON.stringify({
					data: {
						viewer: { id: "lev" },
						projects: {
							nodes: [
								{
									id: "orphan",
									name: "Orphan",
									slugId: "ORPHAN",
									updatedAt: "2026-08-01T12:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
						issues: {
							nodes: [],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				}),
				{ status: 200 },
			);
		};
	}
	const linear = linearFake({
		project: {
			id: "plat",
			name: "Shown",
			slugId: "PLAT",
		},
		issues: [
			{
				identifier: "PLAT-1",
				title: "Ticket 1",
				updatedAt: "2026-08-01T12:00:00.000Z",
				state: { type: "unstarted" },
				attachments: {
					nodes: [
						{
							url: `https://github.com/${shown}/pull/2`,
							title: "Review me",
							sourceType: "github",
						},
					],
				},
			},
		],
		github: async (input, init) => recordedBots(requests, input, init),
		requests,
	});
	return linear;
}

function recordedBots(
	requests: string[],
	input: string | URL | Request,
	init?: RequestInit,
): Response {
	recordTracker(requests, input);
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	const sent = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return page([
			{
				full_name: shown,
				owner: { login: "lev" },
				permissions: { push: true },
				pushed_at: "2026-08-01T12:00:00.000Z",
			},
		]);
	}
	if (url === "https://api.github.com/graphql" && sent.includes("$owner")) {
		return new Response(
			JSON.stringify({
				data: {
					repositoryOwner: {
						projectV2: {
							id: "PVT_acme_7",
							number: 7,
							title: "Acme board",
							closed: false,
							updatedAt: "2026-08-01T12:00:00Z",
						},
					},
				},
			}),
			{ status: 200 },
		);
	}
	const fields = emptyProjectFields(input, init);
	if (fields !== null) {
		return fields;
	}
	if (url === "https://api.github.com/graphql" && sent.includes("node(id:")) {
		if (sent.includes("ProjectV2") || sent.includes("items(first:")) {
			return new Response(
				JSON.stringify({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											id: "I_shown_1",
											number: 1,
											title: "Ticket 1",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-01T12:00:00.000Z",
											repository: { nameWithOwner: shown },
											comments: { totalCount: 0 },
											closedByPullRequestsReferences: {
												nodes: [
													{
														number: 2,
														repository: { nameWithOwner: shown },
													},
												],
												pageInfo: {
													hasNextPage: false,
													endCursor: null,
												},
											},
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200 },
			);
		}
		return new Response(
			JSON.stringify({
				data: {
					node: {
						closedByPullRequestsReferences: {
							nodes: [
								{
									number: 2,
									repository: { nameWithOwner: shown },
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			}),
			{ status: 200 },
		);
	}
	if (url === "https://api.github.com/graphql") {
		return new Response(
			JSON.stringify({
				data: {
					repository: {
						pullRequest: {
							closingIssuesReferences: { nodes: [{ number: 1 }] },
						},
					},
				},
			}),
			{ status: 200 },
		);
	}
	if (url.startsWith(`https://api.github.com/repos/${shown}/issues?`)) {
		return page([
			{
				number: 1,
				title: "Ticket 1",
				state: "open",
				state_reason: null,
				html_url: `https://github.com/${shown}/issues/1`,
				updated_at: "2026-08-01T12:00:00.000Z",
				body: "",
			},
		]);
	}
	if (
		url.startsWith(`https://api.github.com/repos/${shown}/pulls?state=open`)
	) {
		return page([openReviewPull(shown)]);
	}
	if (
		url.startsWith(`https://api.github.com/repos/${shown}/pulls?state=closed`)
	) {
		return page([mergedBotPull(shown)]);
	}
	if (url === `https://api.github.com/repos/${shown}/pulls/2`) {
		return new Response(JSON.stringify(openReviewPull(shown)), {
			status: 200,
		});
	}
	if (
		url.includes(`/commits/${reviewHead}/check-runs`) ||
		url.includes("/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/check-runs")
	) {
		return new Response(
			JSON.stringify({
				check_runs: url.includes(reviewHead)
					? []
					: [
							{
								name: "Grok code review",
								status: "completed",
								conclusion: "success",
								app: { slug: "grok-code-review" },
							},
						],
			}),
			{ status: 200 },
		);
	}
	if (url.includes("/check-runs")) {
		return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
	}
	if (
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/labels") ||
		url.includes("/branches")
	) {
		return page([]);
	}
	if (url.includes("/repos/") && url.includes("/issues?")) {
		return page([]);
	}
	return unrecorded(input);
}

const savedRoot = "/var/tmp/project-flow-saved-root";
const savedRepo = "acme/from-saved-root";

function checkoutFor(root: string): LocalCheckout {
	return {
		tracker: "github",
		path: `${root}/acme/from-saved-root`,
		repo: savedRepo,
		originOwner: "acme",
		hasTrackerConfig: true,
		names: [],
	};
}

async function withAppFile(
	path: string,
	check: (
		base: string,
		configPath: string,
		requests: string[],
	) => Promise<void>,
	listCheckouts?: (roots: string[]) => Promise<LocalCheckout[]>,
	makeFetch: (requests: string[]) => Fetch = fetching,
): Promise<void> {
	const root = await mkdtemp(join("/var/tmp", "project-flow-settings-"));
	const requests: string[] = [];
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			check(base, path, requests).then(resolve, reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: makeFetch(requests),
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
				...(listCheckouts === undefined ? {} : { listCheckouts }),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function withApp(
	body: string,
	check: (
		base: string,
		configPath: string,
		requests: string[],
	) => Promise<void>,
	listCheckouts?: (roots: string[]) => Promise<LocalCheckout[]>,
	makeFetch: (requests: string[]) => Fetch = fetching,
): Promise<void> {
	const { path, cleanup } = await tempConfig(body);
	try {
		await withAppFile(path, check, listCheckouts, makeFetch);
	} finally {
		await cleanup();
	}
}

describe("settings", () => {
	test("a settings change writes a valid configuration and untracks the project", async () => {
		await withApp(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
			async (base, _path, requests) => {
				const before = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(before.projects.map((project) => project.name).sort()).toEqual([
					shown,
				]);

				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(current.pollIntervalSeconds).toBe(300);
				expect(current.needsYouLabels).toEqual([
					"needs-human",
					"needs-engineer",
				]);
				expect(current.notificationTriggers).toEqual({
					needsYou: true,
					comment: true,
					blockerCleared: true,
				});

				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						tracked: [{ tracker: "github", repo: quiet }],
						pollIntervalSeconds: 120,
						expectedBots: { [quiet]: ["grok"] },
						pmBot: { [quiet]: false },
						needsYouLabels: ["needs-human"],
						notificationTriggers: {
							needsYou: false,
							comment: true,
							blockerCleared: false,
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.tracked).toEqual([{ tracker: "github", repo: quiet }]);
				expect(written.pollIntervalSeconds).toBe(120);
				expect(written.expectedBots).toEqual({ [quiet]: ["grok"] });
				expect(written.pmBot).toEqual({ [quiet]: false });
				expect(written.needsYouLabels).toEqual(["needs-human"]);
				expect(written.notificationTriggers.needsYou).toBe(false);
				const reread = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(reread).toEqual(written);

				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const after = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(after.projects.map((project) => project.name)).toEqual([quiet]);
				expect(
					requests.some((url) => url.includes(`/repos/${quiet}/issues?`)),
				).toBe(true);
				expect(
					requests.some((url) => url.includes(`/repos/${shown}/issues?`)),
				).toBe(true);
			},
		);
	});

	test("an invalid settings write names the field and leaves the file", async () => {
		await withApp(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
			async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ pollIntervalSeconds: 0, extra: true }),
				});
				expect(saved.status).toBe(400);
				const body = (await saved.json()) as { error: string };
				expect(body.error).toContain("pollIntervalSeconds");
				const after = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(after).toEqual(before);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(overview.projects.map((project) => project.name)).toContain(
					shown,
				);
			},
		);
	});

	test("repeated spaces and a blank number name the field and leave the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					tracked: [{ tracker: "github", repo: "  acme/spaced  " }],
				}),
			});
			expect(saved.status).toBe(400);
			const spaced = (await saved.json()) as { error: string };
			expect(spaced.error).toContain("tracked");
			const afterSpaces = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterSpaces).toEqual(before);
			const blank = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					pollIntervalSeconds: Number("   "),
				}),
			});
			expect(blank.status).toBe(400);
			const named = (await blank.json()) as { error: string };
			expect(named.error).toContain("pollIntervalSeconds");
			const afterBlank = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterBlank).toEqual(before);
		});
	});

	test("a settings write during a refresh keeps the saved values", async () => {
		let releaseIssues: () => void = () => {};
		const issuesHeld = new Promise<void>((resolve) => {
			releaseIssues = resolve;
		});
		let enteredHold: () => void = () => {};
		const holding = new Promise<void>((resolve) => {
			enteredHold = resolve;
		});
		let holdIssues = false;
		const heldRequests: string[] = [];
		const held: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (holdIssues && url.includes("/repos/") && url.includes("/issues?")) {
				enteredHold();
				await issuesHeld;
			}
			return recorded(heldRequests, input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-settings-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				(async () => {
					const ready = await fetch(new URL("/api/overview", base));
					expect(ready.status).toBe(200);
					holdIssues = true;
					const refreshing = fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					await holding;
					const current = await (
						await fetch(new URL("/api/settings", base))
					).json();
					const saving = fetch(new URL("/api/settings", base), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							...current,
							pollIntervalSeconds: 90,
						}),
					});
					holdIssues = false;
					await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
					releaseIssues();
					const saved = await saving;
					expect(saved.status).toBe(200);
					expect(await saved.json()).toMatchObject({
						pollIntervalSeconds: 90,
					});
					expect((await refreshing).status).toBe(204);
					const after = await (
						await fetch(new URL("/api/settings", base))
					).json();
					expect(after).toMatchObject({
						pollIntervalSeconds: 90,
					});
					expect(
						heldRequests.some((url) => url.includes(`/repos/${shown}/issues?`)),
					).toBe(true);
				})().then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: held,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releaseIssues();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a saved checkout root lists only the checkout that root returns", async () => {
		const startupRoot = "/var/tmp/project-flow-startup-root";
		await withApp(
			JSON.stringify({ checkoutRoots: [startupRoot] }),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & { projects: { key: string }[] };
				expect(current.projects.map((project) => project.key)).not.toContain(
					savedRepo,
				);
				expect(current.checkoutRoots).toEqual([startupRoot]);
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						checkoutRoots: [savedRoot],
					}),
				});
				expect(saved.status).toBe(200);
				const put = (await saved.json()) as Configuration & {
					projects: { key: string }[];
				};
				expect(put.checkoutRoots).toEqual([savedRoot]);
				expect(put.projects.map((project) => project.key)).toContain(savedRepo);
				const reread = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(reread.checkoutRoots).toEqual([savedRoot]);
			},
			async (roots) =>
				roots.includes(savedRoot) ? [checkoutFor(savedRoot)] : [],
		);
	});

	test("an unknown bot names the field and leaves the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					expectedBots: { "acme/shown": ["not-a-bot"] },
				}),
			});
			expect(saved.status).toBe(400);
			const named = (await saved.json()) as { error: string };
			expect(named.error).toContain("expectedBots");
			const after = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(after).toEqual(before);
		});
	});

	test("a symlinked 0600 config stays a symlink and its target keeps mode 0600", async () => {
		const dir = await mkdtemp(join("/var/tmp", "project-flow-settings-link-"));
		const target = join(dir, "target.json");
		const link = join(dir, "config.json");
		await writeFile(
			target,
			JSON.stringify({
				tracked: [{ tracker: "github", repo: shown }],
				checkoutRoots: [],
			}),
		);
		await chmod(target, 0o600);
		await symlink(target, link);
		const root = await mkdtemp(join("/var/tmp", "project-flow-settings-"));
		const requests: string[] = [];
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				(async () => {
					const current = await (
						await fetch(new URL("/api/settings", base))
					).json();
					const saved = await fetch(new URL("/api/settings", base), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							...current,
							pollIntervalSeconds: 120,
						}),
					});
					expect(saved.status).toBe(200);
					const linkStat = await lstat(link);
					expect(linkStat.isSymbolicLink()).toBe(true);
					const targetStat = await lstat(target);
					expect(targetStat.isSymbolicLink()).toBe(false);
					expect(targetStat.mode & 0o777).toBe(0o600);
					const written = (await saved.json()) as Configuration;
					expect(written.pollIntervalSeconds).toBe(120);
					const reread = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Configuration;
					expect(reread.pollIntervalSeconds).toBe(120);
					expect(
						requests.some((url) => url.includes(`/repos/${shown}/issues?`)),
					).toBe(true);
				})().then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", link, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetching(requests),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank PM Bot line and a bare name leave the saved flags", async () => {
		const linear = "linear-project";
		const savedFlags = { [linear]: true, [quiet]: false };
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "linear", project: linear },
					{ tracker: "github", repo: shown },
				],
				pmBot: savedFlags,
			}),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(current.pmBot).toEqual(savedFlags);

				const rejected = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						pmBot: `${linear} true\n\n${quiet}`,
					}),
				});
				expect(rejected.status).toBe(400);
				const body = (await rejected.json()) as { error: string };
				expect(body.error).toContain("pmBot");

				const written = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(written.pmBot).toEqual(savedFlags);
			},
		);
	});

	test("an unchanged menu keeps an explicit PM Bot false", async () => {
		const linear = "linear-project";
		const savedFlags = { [linear]: true, [quiet]: false };
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "linear", project: linear },
					{ tracker: "github", repo: shown },
				],
				pmBot: savedFlags,
			}),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(current.pmBot).toEqual(savedFlags);

				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(current),
				});
				expect(saved.status).toBe(200);
				const body = (await saved.json()) as Configuration;
				expect(body.pmBot).toEqual(savedFlags);

				const written = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(written.pmBot).toEqual(savedFlags);
			},
		);
	});

	test("a saved dark theme survives a restart", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		try {
			await withAppFile(path, async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(before.theme).toBe("light");
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...before, theme: "dark" }),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.theme).toBe("dark");
				const page = await fetch(new URL("/", base));
				expect(page.status).toBe(200);
				expect(await page.text()).toContain('data-theme="dark"');
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.theme).toBe("dark");
				const page = await fetch(new URL("/", base));
				expect(page.status).toBe(200);
				expect(await page.text()).toContain('data-theme="dark"');
			});
		} finally {
			await cleanup();
		}
	}, 30_000);

	test("a settings save keeps a theme written after the menu loaded", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const loaded = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(loaded.theme).toBe("light");
			const theme = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...loaded, theme: "dark" }),
			});
			expect(theme.status).toBe(200);
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...loaded,
					pollIntervalSeconds: 90,
					theme: (
						(await (
							await fetch(new URL("/api/settings", base))
						).json()) as Configuration
					).theme,
				}),
			});
			expect(saved.status).toBe(200);
			const written = (await saved.json()) as Configuration;
			expect(written.theme).toBe("dark");
			expect(written.pollIntervalSeconds).toBe(90);
			const current = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(current.theme).toBe("dark");
			expect(current.pollIntervalSeconds).toBe(90);
		});
	});

	test("a settings save keeps a theme edit made in the loaded menu", async () => {
		await withApp(
			JSON.stringify({ pinned: [], theme: "dark" }),
			async (base) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...loaded, theme: "light" }),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.theme).toBe("light");
			},
		);
	});

	test("a view-only settings write answers while a poll is held open and sends no tracker request", async () => {
		let releaseIssues: () => void = () => {};
		const issuesHeld = new Promise<void>((resolve) => {
			releaseIssues = resolve;
		});
		let enteredHold: () => void = () => {};
		const holding = new Promise<void>((resolve) => {
			enteredHold = resolve;
		});
		let holdIssues = false;
		const heldRequests: string[] = [];
		const held: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (holdIssues && url.includes("/repos/") && url.includes("/issues?")) {
				enteredHold();
				await issuesHeld;
			}
			return recorded(heldRequests, input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-settings-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				(async () => {
					const ready = await fetch(new URL("/api/overview", base));
					expect(ready.status).toBe(200);
					const beforeRefresh = heldRequests.length;
					holdIssues = true;
					const refreshing = fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					await holding;
					const current = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Configuration;
					expect(current.theme).toBe("light");
					const sent = heldRequests.length;
					const started = Date.now();
					const saving = fetch(new URL("/api/settings", base), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ ...current, theme: "dark" }),
					});
					const saved = await saving;
					expect(Date.now() - started).toBeLessThan(2_000);
					expect(saved.status).toBe(200);
					expect(heldRequests.length).toBe(sent);
					const written = (await saved.json()) as Configuration;
					expect(written.theme).toBe("dark");
					expect(written.tracked).toEqual(current.tracked);
					expect(written.pollIntervalSeconds).toBe(current.pollIntervalSeconds);
					const page = await fetch(new URL("/", base));
					expect(page.status).toBe(200);
					expect(await page.text()).toContain('data-theme="dark"');
					holdIssues = false;
					releaseIssues();
					expect((await refreshing).status).toBe(204);
					expect(heldRequests.length).toBeGreaterThan(beforeRefresh);
					const after = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Configuration;
					expect(after.theme).toBe("dark");
					expect(after.pollIntervalSeconds).toBe(current.pollIntervalSeconds);
				})().then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: held,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releaseIssues();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a theme save writes the current settings shape and sends no tracker request", async () => {
		await withApp(
			JSON.stringify({ pinned: [] }),
			async (base, _path, requests) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(before.theme).toBe("light");
				const sent = requests.length;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...before, theme: "dark" }),
				});
				expect(saved.status).toBe(200);
				expect(requests.length).toBe(sent);
				const written = (await saved.json()) as Configuration;
				expect(written.theme).toBe("dark");
				expect(written.tracked).toEqual(before.tracked);
				expect(written.pollIntervalSeconds).toBe(before.pollIntervalSeconds);
				expect(written.overview).toEqual(before.overview);
				const again = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(again.theme).toBe("dark");
				const page = await fetch(new URL("/", base));
				expect(page.status).toBe(200);
				expect(await page.text()).toContain('data-theme="dark"');
			},
		);
	});

	test("a blank theme and an unknown theme name the field and leave the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const blank = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...before, theme: "   " }),
			});
			expect(blank.status).toBe(400);
			const blankBody = (await blank.json()) as { error: string };
			expect(blankBody.error).toContain("theme");
			const afterBlank = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterBlank).toEqual(before);
			const unknown = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...before, theme: "sepia" }),
			});
			expect(unknown.status).toBe(400);
			const unknownBody = (await unknown.json()) as { error: string };
			expect(unknownBody.error).toContain("theme");
			const afterUnknown = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterUnknown).toEqual(before);
		});
	});

	test("a tracked github owner/project shows on the overview and a settings write round-trips it", async () => {
		const pin = { tracker: "github" as const, owner: "acme", project: 7 };
		const repo = { tracker: "github" as const, repo: shown };
		await withApp(JSON.stringify({ tracked: [pin, repo] }), async (base) => {
			const onBoard = (overview: Overview) =>
				overview.projects.find(
					(item) =>
						item.ref.tracker === "github" &&
						"owner" in item.ref &&
						item.ref.owner === pin.owner &&
						item.ref.project === pin.project,
				);
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(onBoard(overview)?.ref).toEqual(pin);

			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const removed = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...before, tracked: [repo] }),
			});
			expect(removed.status).toBe(200);
			expect(((await removed.json()) as Configuration).tracked).toEqual([repo]);
			const untracked = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(onBoard(untracked)).toBeUndefined();

			const current = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const restored = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...current, tracked: [repo, pin] }),
			});
			expect(restored.status).toBe(200);
			const written = (await restored.json()) as Configuration;
			expect(written.tracked).toEqual([repo, pin]);
			const reread = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(reread.tracked).toEqual([repo, pin]);
			const after = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(onBoard(after)?.ref).toEqual(pin);
		});
	});

	test("a project graph direction survives a restart", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		try {
			await withAppFile(path, async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(before.projectViews).toEqual({});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...before,
						projectViews: {
							"acme/widget": { graphDirection: "top-to-bottom" },
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.projectViews["acme/widget"]?.graphDirection).toBe(
					"top-to-bottom",
				);
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.projectViews["acme/widget"]?.graphDirection).toBe(
					"top-to-bottom",
				);
			});
		} finally {
			await cleanup();
		}
	});

	test("an unknown project graph direction names the field and leaves the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const rejected = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					projectViews: {
						"acme/widget": { graphDirection: "sideways" },
					},
				}),
			});
			expect(rejected.status).toBe(400);
			const body = (await rejected.json()) as { error: string };
			expect(body.error).toContain("projectViews");
			const after = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(after).toEqual(before);
		});
	});

	test("overview filter, sort and view mode survive a restart", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const overview = {
			filter: "needs-you",
			sort: "blockedBy",
			direction: "desc",
			view: "table",
		} as const;
		try {
			await withAppFile(path, async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(before.overview).toEqual({
					filter: "all",
					sort: "project",
					direction: "asc",
					view: "cards",
				});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...before, overview }),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.overview).toEqual(overview);
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.overview).toEqual(overview);
			});
		} finally {
			await cleanup();
		}
	});

	test("a saved table column and direction survive a restart", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [],
				overview: { filter: "all", sort: "name", view: "cards" },
			}),
		);
		const overview = {
			filter: "all",
			sort: "needsYou",
			direction: "desc",
			view: "table",
		} as const;
		try {
			await withAppFile(path, async (base) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(loaded.overview).toEqual({
					filter: "all",
					sort: "project",
					direction: "asc",
					view: "cards",
				});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...loaded, overview }),
				});
				expect(saved.status).toBe(200);
				expect(((await saved.json()) as Configuration).overview).toEqual(
					overview,
				);
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...loaded,
						overview: { ...overview, direction: "   " },
					}),
				});
				expect(blank.status).toBe(400);
				const kept = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(kept.overview).toEqual(overview);
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.overview).toEqual(overview);
			});
		} finally {
			await cleanup();
		}
	});

	test("a blank overview filter names the field and leaves the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const blank = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					overview: { filter: "   " as const, sort: "name", view: "cards" },
				}),
			});
			expect(blank.status).toBe(400);
			const body = (await blank.json()) as { error: string };
			expect(body.error).toContain("overview.filter");
			const repeated = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					overview: { filter: "sepia" as const, sort: "name", view: "cards" },
				}),
			});
			expect(repeated.status).toBe(400);
			const after = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(after).toEqual(before);
		});
	});

	test("an overview view save skips the tracker poll and any other save polls", async () => {
		await withApp(
			JSON.stringify({ pinned: [] }),
			async (base, _path, requests) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				const seen = requests.length;
				const viewOnly = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...before,
						overview: {
							filter: "needs-you",
							sort: "progress",
							direction: "asc",
							view: "table",
						},
					}),
				});
				expect(viewOnly.status).toBe(200);
				const saved = (await viewOnly.json()) as Configuration;
				expect(saved.overview).toEqual({
					filter: "needs-you",
					sort: "progress",
					direction: "asc",
					view: "table",
				});
				expect(requests.length).toBe(seen);

				const other = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...saved,
						pollIntervalSeconds: 120,
					}),
				});
				expect(other.status).toBe(200);
				expect(requests.length).toBeGreaterThan(seen);
				const after = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(after.pollIntervalSeconds).toBe(120);
				expect(after.overview.view).toBe("table");
			},
		);
	});

	test("each settings section saves and survives a restart", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base, configPath) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration & {
				trackers: { github: boolean; linear: boolean };
			};
			expect(before.trackers).toEqual({ github: true, linear: true });
			expect(JSON.stringify(before)).not.toContain("recorded-token");
			expect(JSON.stringify(before)).not.toContain("recorded-linear-key");

			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					tracked: [{ tracker: "github", repo: shown }],
					pollIntervalSeconds: 60,
					projectViews: {
						"*": {
							openView: "graph",
							graphDirection: "top-to-bottom",
							shownLanes: ["In progress", "Done"],
							maxAgeDays: { Done: 7 },
							needsYouOnly: true,
							blockedOnly: false,
							assignees: [],
							search: "",
						},
					},
					laneMappings: {
						"acme/4": { awaitingMerge: "Approved" },
					},
					autoMerge: { "acme/shown": "ask" },
					needsYouLabels: ["needs-human"],
					viewerLogins: ["AbysmalBiscuit"],
					notificationTriggers: {
						needsYou: false,
						comment: true,
						blockerCleared: false,
					},
				}),
			});
			expect(saved.status).toBe(200);
			const body = (await saved.json()) as Configuration;
			expect(body.tracked).toEqual([{ tracker: "github", repo: shown }]);
			expect(body.pollIntervalSeconds).toBe(60);
			expect(body.projectViews["*"]?.openView).toBe("graph");
			expect(body.projectViews["*"]?.graphDirection).toBe("top-to-bottom");
			expect(body.projectViews["*"]?.shownLanes).toEqual([
				"In progress",
				"Done",
			]);
			expect(body.projectViews["*"]?.maxAgeDays).toEqual({ Done: 7 });
			expect(body.projectViews["*"]?.needsYouOnly).toBe(true);
			expect(body.laneMappings["acme/4"]).toEqual({
				awaitingMerge: "Approved",
			});
			expect(body.autoMerge).toEqual({ "acme/shown": "ask" });
			expect(body.needsYouLabels).toEqual(["needs-human"]);
			expect(body.viewerLogins).toEqual(["AbysmalBiscuit"]);
			expect(body.notificationTriggers).toEqual({
				needsYou: false,
				comment: true,
				blockerCleared: false,
			});
			expect(JSON.stringify(body)).not.toContain("recorded-token");

			await withAppFile(configPath, async (restarted) => {
				const again = (await (
					await fetch(new URL("/api/settings", restarted))
				).json()) as Configuration & {
					trackers: { github: boolean; linear: boolean };
				};
				expect(again.tracked).toEqual([{ tracker: "github", repo: shown }]);
				expect(again.pollIntervalSeconds).toBe(60);
				expect(again.projectViews["*"]?.openView).toBe("graph");
				expect(again.projectViews["*"]?.needsYouOnly).toBe(true);
				expect(again.laneMappings["acme/4"]?.awaitingMerge).toBe("Approved");
				expect(again.autoMerge["acme/shown"]).toBe("ask");
				expect(again.needsYouLabels).toEqual(["needs-human"]);
				expect(again.viewerLogins).toEqual(["AbysmalBiscuit"]);
				expect(again.notificationTriggers.blockerCleared).toBe(false);
				expect(again.trackers).toEqual({ github: true, linear: true });
				expect(JSON.stringify(again)).not.toContain("recorded-linear-key");
			});
		});
	});

	test("settings names a missing tracker credential and keeps the token out", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-settings-"));
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const requests: string[] = [];
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/settings", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const body = (await response.json()) as {
							trackers: { github: boolean; linear: boolean };
						};
						expect(body.trackers).toEqual({ github: false, linear: false });
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {},
					fetch: fetching(requests),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank settings body names the configuration and leaves the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: "   ",
			});
			expect(saved.status).toBe(400);
			const body = (await saved.json()) as { error: string };
			expect(body.error).toContain("configuration");
			const after = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(after).toEqual(before);
		});
	});

	test("settings lists every found and tracked project with its tracker and source", async () => {
		const pinnedOnly = "acme/pinned-only";
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "github", repo: quiet },
					{ tracker: "github", repo: pinnedOnly },
				],
				pmBot: { [shown]: false },
				expectedBots: { [shown]: ["grok", "codex"] },
			}),
			async (base) => {
				const body = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projects: {
						name: string;
						key: string;
						tracker: string;
						source: string;
						tracked: boolean;
						pmBot: boolean;
						expectedBots: string[];
						ref: unknown;
					}[];
				};
				const rows = [...body.projects].sort((left, right) =>
					left.key.localeCompare(right.key),
				);
				expect(rows.map((row) => row.key)).toEqual([
					savedRepo,
					pinnedOnly,
					quiet,
					shown,
				]);
				const byKey = new Map(rows.map((row) => [row.key, row]));
				expect(byKey.get(shown)).toMatchObject({
					tracker: "github",
					source: "found",
					tracked: false,
					pmBot: false,
					expectedBots: ["grok", "codex"],
					ref: { tracker: "github", repo: shown },
				});
				expect(byKey.get(quiet)).toMatchObject({
					tracker: "github",
					source: "found",
					tracked: true,
				});
				expect(byKey.get(pinnedOnly)).toMatchObject({
					tracker: "github",
					source: "tracked",
					tracked: true,
					ref: { tracker: "github", repo: pinnedOnly },
				});
				expect(byKey.get(savedRepo)).toMatchObject({
					tracker: "github",
					source: "found",
					tracked: false,
				});
			},
			async () => [checkoutFor(savedRoot)],
		);
	});

	test("switch and bot changes save and survive a restart", async () => {
		await withApp(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: shown }],
				pmBot: {},
				expectedBots: {},
			}),
			async (base, configPath) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown[];
				};
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				expect(
					current.projects.some(
						(row) =>
							typeof row === "object" &&
							row !== null &&
							"key" in row &&
							row.key === shown,
					),
				).toBe(true);
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						tracked: [{ tracker: "github", repo: quiet }],
						baselineTracked: configuration.tracked,
						pmBot: { [quiet]: false, [shown]: true },
						expectedBots: { [quiet]: ["codex"], [shown]: ["grok"] },
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projects: {
						key: string;
						tracked: boolean;
						pmBot: boolean;
						expectedBots: string[];
					}[];
				};
				const quietRow = written.projects.find((row) => row.key === quiet);
				const shownRow = written.projects.find((row) => row.key === shown);
				expect(quietRow).toMatchObject({
					tracked: true,
					pmBot: false,
					expectedBots: ["codex"],
				});
				expect(shownRow).toMatchObject({
					tracked: false,
					pmBot: true,
					expectedBots: ["grok"],
				});

				await withAppFile(configPath, async (restarted) => {
					const again = (await (
						await fetch(new URL("/api/settings", restarted))
					).json()) as {
						tracked: unknown;
						pmBot: unknown;
						expectedBots: unknown;
						projects: {
							key: string;
							tracked: boolean;
							pmBot: boolean;
							expectedBots: string[];
						}[];
					};
					expect(again.tracked).toEqual([{ tracker: "github", repo: quiet }]);
					expect(again.pmBot).toEqual({ [quiet]: false, [shown]: true });
					expect(again.expectedBots).toEqual({
						[quiet]: ["codex"],
						[shown]: ["grok"],
					});
					expect(again.projects.find((row) => row.key === quiet)).toMatchObject(
						{
							tracked: true,
							pmBot: false,
							expectedBots: ["codex"],
						},
					);
					expect(again.projects.find((row) => row.key === shown)).toMatchObject(
						{
							tracked: false,
							pmBot: true,
							expectedBots: ["grok"],
						},
					);
				});
			},
		);
	});

	test("a settings save keeps a tracked project added after the draft loaded", async () => {
		const added = { tracker: "github" as const, repo: quiet };
		await withApp(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
			async (base) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown;
				};
				const {
					trackers: _trackers,
					projects: _projects,
					...baseline
				} = loaded;
				const other = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...baseline,
						tracked: [...baseline.tracked, added],
					}),
				});
				expect(other.status).toBe(200);
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...baseline,
						pollIntervalSeconds: 60,
						tracked: baseline.tracked,
						baselineTracked: baseline.tracked,
					}),
				});
				expect(saved.status).toBe(200);
				const body = (await saved.json()) as Configuration;
				expect(body.pollIntervalSeconds).toBe(60);
				expect(body.tracked).toEqual([
					{ tracker: "github", repo: shown },
					added,
				]);
			},
		);
	});

	test("expected bot controls save under the repository key and change review state after a restart", async () => {
		const linear = "PLAT";
		const board = "PVT_acme_7";
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "linear", project: linear },
					{ tracker: "github", owner: "acme", project: 7 },
				],
				expectedBots: {},
			}),
			async (base, configPath) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projects: {
						key: string;
						repos: string[];
						expectedBots: string[];
					}[];
				};
				const linearRow = loaded.projects.find((row) => row.key === linear);
				const boardRow = loaded.projects.find((row) => row.key === board);
				expect(linearRow?.repos).toEqual([shown]);
				expect(boardRow?.repos).toEqual([shown]);
				expect(linearRow?.expectedBots).toEqual(["grok"]);
				expect(boardRow?.expectedBots).toEqual(["grok"]);

				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown;
				};
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						expectedBots: { [shown]: ["codex"] },
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration & {
					projects: { key: string; expectedBots: string[] }[];
				};
				expect(written.expectedBots).toEqual({ [shown]: ["codex"] });
				expect(written.expectedBots).not.toHaveProperty(linear);
				expect(written.expectedBots).not.toHaveProperty(board);
				for (const key of [linear, board]) {
					expect(
						written.projects.find((row) => row.key === key)?.expectedBots,
					).toEqual(["codex"]);
				}

				const before = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				const reviewed = before.projects.find(
					(project) => project.name === "Shown",
				);
				const boardCard = before.projects.find(
					(project) => project.name === "Acme board",
				);
				expect(reviewed?.inReview).toBe(1);
				expect(reviewed?.awaitingMerge).toBe(0);
				expect(boardCard?.name).toBe("Acme board");
				expect(boardCard?.inReview).toBe(1);
				expect(boardCard?.awaitingMerge).toBe(0);

				await withAppFile(
					configPath,
					async (restarted) => {
						const again = (await (
							await fetch(new URL("/api/settings", restarted))
						).json()) as Configuration & {
							projects: { key: string; expectedBots: string[] }[];
						};
						expect(again.expectedBots).toEqual({ [shown]: ["codex"] });
						expect(again.expectedBots).not.toHaveProperty(linear);
						expect(again.expectedBots).not.toHaveProperty(board);
						for (const key of [linear, board]) {
							expect(
								again.projects.find((row) => row.key === key)?.expectedBots,
							).toEqual(["codex"]);
						}
						const overview = (await (
							await fetch(new URL("/api/overview", restarted))
						).json()) as Overview;
						const card = overview.projects.find(
							(project) => project.name === "Shown",
						);
						const boardAgain = overview.projects.find(
							(project) => project.name === "Acme board",
						);
						expect(card?.inReview).toBe(1);
						expect(card?.awaitingMerge).toBe(0);
						expect(boardAgain?.inReview).toBe(1);
						expect(boardAgain?.awaitingMerge).toBe(0);
					},
					async () => [],
					fetchingBots,
				);
			},
			async () => [],
			fetchingBots,
		);
	});

	test("an unknown repository leaves expected bots unavailable and unsaved", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "ORPHAN" }],
				expectedBots: {},
			}),
			async (base) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projects: { key: string; repos: string[] }[];
				};
				expect(loaded.projects.map((row) => row.key)).toEqual(["ORPHAN"]);
				const orphan = loaded.projects.find((row) => row.key === "ORPHAN");
				expect(orphan?.repos ?? []).toEqual([]);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown;
				};
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						expectedBots: { ORPHAN: ["grok"] },
					}),
				});
				expect(saved.status).toBe(400);
				const after = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(after.expectedBots ?? {}).toEqual({});
			},
			async () => [],
			(requests) => fetchingBots(requests, true),
		);
	});

	test("removing the last expected bot saves an empty override for that repository", async () => {
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "github", repo: shown },
					{ tracker: "linear", project: "PLAT" },
				],
				expectedBots: { [shown]: ["grok"] },
			}),
			async (base, configPath) => {
				const before = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(
					before.projects.find((project) => project.name === "Shown")?.inReview,
				).toBe(1);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: { key: string; repos: string[]; expectedBots: string[] }[];
				};
				const row = current.projects.find((item) => item.key === shown);
				expect(row?.repos).toEqual([shown]);
				expect(row?.expectedBots).toEqual(["grok"]);
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						expectedBots: { [shown]: [] },
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration & {
					projects: { key: string; expectedBots: string[] }[];
				};
				expect(written.expectedBots).toEqual({ [shown]: [] });
				expect(
					written.projects.find((item) => item.key === shown)?.expectedBots,
				).toEqual([]);

				await withAppFile(
					configPath,
					async (restarted) => {
						const again = (await (
							await fetch(new URL("/api/settings", restarted))
						).json()) as Configuration & {
							projects: { key: string; expectedBots: string[] }[];
						};
						expect(again.expectedBots).toEqual({ [shown]: [] });
						expect(
							again.projects.find((item) => item.key === shown)?.expectedBots,
						).toEqual([]);
						const overview = (await (
							await fetch(new URL("/api/overview", restarted))
						).json()) as Overview;
						const card = overview.projects.find(
							(project) => project.name === "Shown",
						);
						expect(card?.inReview).toBe(0);
						expect(card?.awaitingMerge).toBe(1);
					},
					async () => [],
					fetchingBots,
				);
			},
			async () => [],
			fetchingBots,
		);
	});

	test("adding the first expected bot keeps the inferred bots for that repository", async () => {
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "github", repo: shown },
					{ tracker: "linear", project: "PLAT" },
				],
				expectedBots: {},
			}),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: {
						key: string;
						repos: string[];
						expectedBots: string[];
						repoBots: Record<string, string[]>;
					}[];
				};
				const row = current.projects.find((item) => item.key === shown);
				expect(row?.repos).toEqual([shown]);
				expect(row?.expectedBots).toEqual(["grok"]);
				expect(row?.repoBots).toEqual({ [shown]: ["grok"] });
				expect(current.expectedBots ?? {}).toEqual({});
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						expectedBots: { [shown]: ["grok", "codex"] },
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration & {
					projects: {
						key: string;
						expectedBots: string[];
						repoBots: Record<string, string[]>;
					}[];
				};
				expect(written.expectedBots).toEqual({ [shown]: ["grok", "codex"] });
				const shownRow = written.projects.find((item) => item.key === shown);
				expect(shownRow?.expectedBots).toEqual(["grok", "codex"]);
				expect(shownRow?.repoBots).toEqual({ [shown]: ["grok", "codex"] });
			},
			async () => [],
			fetchingBots,
		);
	});

	test("deleting an empty expected-bot override restores inferred bots", async () => {
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "github", repo: shown },
					{ tracker: "linear", project: "PLAT" },
				],
				expectedBots: { [shown]: [] },
			}),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown;
				};
				expect(
					current.projects &&
						Array.isArray(current.projects) &&
						current.projects.some(
							(row) =>
								typeof row === "object" &&
								row !== null &&
								"key" in row &&
								row.key === shown &&
								"expectedBots" in row &&
								Array.isArray(row.expectedBots) &&
								row.expectedBots.length === 0,
						),
				).toBe(true);
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const { expectedBots: _bots, ...without } = configuration;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(without),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration & {
					projects: { key: string; expectedBots: string[] }[];
				};
				expect(written.expectedBots).toBeUndefined();
				const shownRow = written.projects.find((row) => row.key === shown);
				expect(shownRow?.expectedBots).toEqual(["grok"]);
				expect(shownRow?.expectedBots).toEqual(["grok"]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(
					overview.projects.find((project) => project.name === "Shown")
						?.inReview,
				).toBe(1);
			},
			async () => [],
			fetchingBots,
		);
	});
});
