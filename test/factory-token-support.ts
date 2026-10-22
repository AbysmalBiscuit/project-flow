import { expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedIssues from "./fixtures/github-issues.json";
import {
	recordedDiscovery,
	repoReadFromLists,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

export const userToken = "recorded-user-token";
export const acmeToken = "ghs_acme_installation";
export const userBearer = `Bearer ${userToken}`;
export const acmeBearer = `Bearer ${acmeToken}`;

export type Recorded = {
	url: string;
	method: string;
	authorization: string | null;
	body: string;
};

export function hostsText(token: string, expiresAt: string): string {
	return [
		"github.com:",
		`    oauth_token: ${token}`,
		"    git_protocol: https",
		"    user: x-access-token",
		`    expires_at: ${expiresAt}`,
		"",
	].join("\n");
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export function recordedIssue(
	repo: string,
	number?: number,
): Record<string, unknown> {
	const source = recordedIssues[0];
	if (source === undefined) {
		throw new Error("recorded github issue fixture is empty");
	}
	const issue = structuredClone(source) as Record<string, unknown>;
	if (number !== undefined) {
		issue.number = number;
	}
	const ticket = typeof issue.number === "number" ? issue.number : number;
	issue.html_url = `https://github.com/${repo}/issues/${ticket}`;
	return issue;
}

export function recordingFetch(
	recorded: Recorded[],
	issues: Record<string, Record<string, unknown>[]>,
	orgProjects?: (login: string) => unknown,
): Fetch {
	return async (input, init) => {
		const url = urlOf(input);
		const method = (
			init?.method ?? (input instanceof Request ? input.method : "GET")
		).toUpperCase();
		const headers = new Headers(init?.headers);
		if (url.startsWith("https://api.github.com/")) {
			recorded.push({
				url,
				method,
				authorization: headers.get("authorization"),
				body: typeof init?.body === "string" ? init.body : "",
			});
		}
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		if (url === "https://api.github.com/graphql" && method === "POST") {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("OrgProjects")) {
				const parsed = JSON.parse(sent) as { variables?: { login?: string } };
				const login = parsed.variables?.login ?? "";
				if (orgProjects !== undefined) {
					return json(orgProjects(login));
				}
				return json({
					data: {
						organization: {
							projectsV2: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			if (sent.includes("ViewerProjects")) {
				return json({
					data: {
						viewer: {
							login: "lev",
							projectsV2: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
							organizations: {
								nodes: orgProjects === undefined ? [] : [{ login: "acme" }],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			const parsed = JSON.parse(sent) as {
				variables?: { owner?: string; name?: string };
			};
			const owner = parsed.variables?.owner;
			const name = parsed.variables?.name;
			if (owner !== undefined && name !== undefined) {
				const repo = `${owner}/${name}`;
				const read = repoReadFromLists(input, init, {
					[repo]: issues[repo] ?? [],
				});
				if (read !== null) {
					return read;
				}
			}
			return json({ data: {} });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const list = url.match(
			/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?/,
		);
		if (list?.[1] !== undefined && method === "GET") {
			return json(issues[list[1]] ?? []);
		}
		const one = url.match(
			/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/,
		);
		if (one?.[1] !== undefined && one[2] !== undefined && method === "GET") {
			const found = (issues[one[1]] ?? []).find(
				(item) => String(item.number) === one[2],
			);
			return found === undefined ? unrecorded(input) : json(found);
		}
		const comments = url.match(
			/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/,
		);
		if (comments !== null && method === "GET") {
			return json([]);
		}
		if (comments !== null && method === "POST") {
			const repo = comments[1];
			const number = comments[2];
			return json(
				{
					id: 900,
					body: "Posted",
					html_url: `https://github.com/${repo}/issues/${number}#issuecomment-900`,
					created_at: "2026-08-18T13:00:00.000Z",
					user: { login: "lev" },
				},
				201,
			);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/labels?") ||
			url.includes("/branches?")
		) {
			return json([]);
		}
		return unrecorded(input);
	};
}

export async function serve(options: {
	config: Record<string, unknown>;
	fetchImpl: Fetch;
	now: () => Date;
	home: string;
}): Promise<{ base: string; stop: () => Promise<void> }> {
	const { path, cleanup } = await tempConfig(JSON.stringify(options.config));
	const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
	await writeFile(join(root, "notes.txt"), "untracked harness file\n");
	let startChecks: (base: string) => void = () => {};
	const ready = new Promise<string>((resolve) => {
		startChecks = resolve;
	});
	const stopped = new Promise<void>((resolve) => {
		void ready.then(() => {
			stop = async () => {
				resolve();
				await cleanup();
				await rm(root, { recursive: true, force: true });
			};
		});
	});
	let stop: () => Promise<void> = async () => {};
	const running = run(
		["--config", path, "--host", "127.0.0.1", "--port", "0"],
		testIo({
			env: { GITHUB_TOKEN: userToken, HOME: options.home },
			fetch: options.fetchImpl,
			readGhToken: async () => null,
			databasePath: join(root, "store.sqlite"),
			now: options.now,
			stdout: (line) => startChecks(line),
			stderr: (line) => {
				throw new Error(line);
			},
			waitForStop: stopped,
		}),
	);
	const base = await ready;
	return {
		base,
		stop: async () => {
			await stop();
			const result = await running;
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		},
	};
}

export function githubCalls(recorded: Recorded[]): Recorded[] {
	return recorded.filter((item) =>
		item.url.startsWith("https://api.github.com/"),
	);
}

export function forOwner(recorded: Recorded[], owner: string): Recorded[] {
	return recorded.filter(
		(item) =>
			item.url.includes(`/repos/${owner}/`) ||
			item.body.includes(`"owner":"${owner}"`) ||
			item.body.includes(`"login":"${owner}"`) ||
			item.body.includes(`"projectOwner":"${owner}"`),
	);
}
