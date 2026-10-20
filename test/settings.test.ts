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
				fetch: fetching(requests),
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
): Promise<void> {
	const { path, cleanup } = await tempConfig(body);
	try {
		await withAppFile(path, check, listCheckouts);
	} finally {
		await cleanup();
	}
}

describe("settings", () => {
	test("a settings change writes a valid configuration and hides the project", async () => {
		await withApp(
			JSON.stringify({ pinned: [] }),
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
				expect(current.activityWindowDays).toBe(30);
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
						pinned: [{ tracker: "github", repo: quiet }],
						hidden: [{ tracker: "github", repo: shown }],
						activityWindowDays: 14,
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
				expect(written.hidden).toEqual([{ tracker: "github", repo: shown }]);
				expect(written.pinned).toEqual([{ tracker: "github", repo: quiet }]);
				expect(written.activityWindowDays).toBe(14);
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
			JSON.stringify({
				pinned: [{ tracker: "github", repo: shown }],
				activityWindowDays: 30,
			}),
			async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ activityWindowDays: 0, extra: true }),
				});
				expect(saved.status).toBe(400);
				const body = (await saved.json()) as { error: string };
				expect(body.error).toContain("activityWindowDays");
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
					pinned: [{ tracker: "github", repo: "  acme/spaced  " }],
				}),
			});
			expect(saved.status).toBe(400);
			const spaced = (await saved.json()) as { error: string };
			expect(spaced.error).toContain("pinned");
			const afterSpaces = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterSpaces).toEqual(before);
			const blank = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					activityWindowDays: Number("   "),
				}),
			});
			expect(blank.status).toBe(400);
			const named = (await blank.json()) as { error: string };
			expect(named.error).toContain("activityWindowDays");
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
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
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
							activityWindowDays: 14,
							pollIntervalSeconds: 90,
						}),
					});
					holdIssues = false;
					await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
					releaseIssues();
					const saved = await saving;
					expect(saved.status).toBe(200);
					expect(await saved.json()).toMatchObject({
						activityWindowDays: 14,
						pollIntervalSeconds: 90,
					});
					expect((await refreshing).status).toBe(204);
					const after = await (
						await fetch(new URL("/api/settings", base))
					).json();
					expect(after).toMatchObject({
						activityWindowDays: 14,
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
			JSON.stringify({ pinned: [], checkoutRoots: [startupRoot] }),
			async (base) => {
				const before = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(before.projects.map((project) => project.name)).not.toContain(
					savedRepo,
				);

				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
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
				const put = (await saved.json()) as Configuration;
				expect(put.checkoutRoots).toEqual([savedRoot]);
				const reread = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(reread.checkoutRoots).toEqual([savedRoot]);
				const after = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(after.projects.map((project) => project.name)).toContain(
					savedRepo,
				);
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
		await writeFile(target, JSON.stringify({ pinned: [], checkoutRoots: [] }));
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
							activityWindowDays: 14,
						}),
					});
					expect(saved.status).toBe(200);
					const linkStat = await lstat(link);
					expect(linkStat.isSymbolicLink()).toBe(true);
					const targetStat = await lstat(target);
					expect(targetStat.isSymbolicLink()).toBe(false);
					expect(targetStat.mode & 0o777).toBe(0o600);
					const written = (await saved.json()) as Configuration;
					expect(written.activityWindowDays).toBe(14);
					const reread = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Configuration;
					expect(reread.activityWindowDays).toBe(14);
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
				pinned: [{ tracker: "linear", project: linear }],
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
				pinned: [{ tracker: "linear", project: linear }],
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

	test("a github owner/project pin is pinned on the overview and a Pinned menu write round-trips it", async () => {
		const pin = { tracker: "github" as const, owner: "acme", project: 7 };
		await withApp(JSON.stringify({ pinned: [pin] }), async (base) => {
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			const project = overview.projects.find(
				(item) =>
					item.ref.tracker === "github" &&
					"owner" in item.ref &&
					item.ref.owner === pin.owner &&
					item.ref.project === pin.project,
			);
			expect(project).toBeDefined();
			expect(project?.pinned).toBe(true);
			expect(project?.ref).toEqual(pin);

			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const removed = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...before, pinned: [] }),
			});
			expect(removed.status).toBe(200);
			expect(((await removed.json()) as Configuration).pinned).toEqual([]);

			const current = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const restored = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...current, pinned: [pin] }),
			});
			expect(restored.status).toBe(200);
			const written = (await restored.json()) as Configuration;
			expect(written.pinned).toEqual([pin]);
			const reread = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(reread.pinned).toEqual([pin]);
			const after = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(
				after.projects.find((item) => item.name === project?.name)?.pinned,
			).toBe(true);
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
});
