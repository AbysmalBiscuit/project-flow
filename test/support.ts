import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import type { RunIo } from "../src/main.ts";

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

export function recordedDiscovery(
	input: string | URL | Request,
	init?: RequestInit,
): Response | null {
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url.startsWith("https://api.github.com/user/repos")) {
		return new Response("[]", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (
		url === "https://api.github.com/graphql" &&
		(body.includes("ViewerProjects") || body.includes("OrgProjects"))
	) {
		return new Response(
			JSON.stringify({
				data: {
					viewer: {
						login: "lev",
						projectsV2: emptyPage,
						organizations: emptyPage,
					},
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	if (
		url === "https://api.linear.app/graphql" &&
		body.includes("MemberProjects")
	) {
		return new Response(
			JSON.stringify({
				data: { viewer: { id: "lev" }, projects: emptyPage },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	return null;
}

export function unrecorded(input: string | URL | Request): Response {
	const url = urlOf(input);
	if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/labels\?/.test(url)) {
		return new Response("[]", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url)) {
		return new Response("{}", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	return (
		recordedDiscovery(input) ?? new Response("not recorded", { status: 404 })
	);
}

export function emptyProjectFields(
	input: string | URL | Request,
	init?: RequestInit,
): Response | null {
	const body = typeof init?.body === "string" ? init.body : "";
	if (urlOf(input) !== "https://api.github.com/graphql") {
		return null;
	}
	if (!body.includes("ProjectFields")) {
		return null;
	}
	return new Response(
		JSON.stringify({
			data: { node: { fields: { nodes: [{}] } } },
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

export function urlOf(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

export async function tempConfig(
	body: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "project-flow-"));
	const path = join(dir, "config.json");
	let written = body;
	try {
		const parsed = JSON.parse(body) as { checkoutRoots?: unknown };
		if (parsed.checkoutRoots === undefined) {
			written = JSON.stringify({ ...parsed, checkoutRoots: [] });
		}
	} catch {
		written = body;
	}
	await writeFile(path, written);
	return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function testIo(io: RunIo, options?: { first?: boolean }): RunIo {
	const stdout = io.stdout;
	const first = options?.first === true;
	return {
		listTodos: async () => "",
		...io,
		...(stdout === undefined
			? {}
			: {
					stdout: (line: string) => {
						if (first) {
							stdout(line);
							return;
						}
						void (async () => {
							const deadline = Date.now() + 3_000;
							while (Date.now() < deadline) {
								const response = await fetch(
									new URL("/api/overview", line),
								).catch(() => null);
								if (response === null || !response.ok) {
									break;
								}
								const body = (await response.json()) as { polling?: true };
								if (body.polling !== true) {
									break;
								}
								await Bun.sleep(20);
							}
							stdout(line);
						})();
					},
				}),
	};
}

export type TrackerRequest = {
	url: string;
	query: string;
	variables: Record<string, unknown>;
};

export type LinearFake = {
	project?: {
		id: string;
		name: string;
		slugId: string;
		teams?: { nodes: { id: string; key: string; name: string }[] };
	} | null;
	states?: {
		id: string;
		name: string;
		type: string;
		position: number;
		color: string;
	}[];
	issues?: Record<string, unknown>[];
	pages?: { nodes: Record<string, unknown>[]; endCursor: string | null }[];
	fail?: "lookup" | "issues" | "key" | "reply";
	status?: number;
	requests?: string[];
	sent?: TrackerRequest[];
	github?: Fetch;
};

export function trackerRequest(
	input: string | URL | Request,
	init?: RequestInit,
): TrackerRequest {
	const body = typeof init?.body === "string" ? init.body : "";
	let query = "";
	let variables: Record<string, unknown> = {};
	if (body !== "") {
		const parsed = JSON.parse(body) as {
			query?: string;
			variables?: Record<string, unknown>;
		};
		query = parsed.query ?? "";
		variables = parsed.variables ?? {};
	}
	return { url: urlOf(input), query, variables };
}

function linearJson(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export function linearFake(options: LinearFake = {}): Fetch {
	const project =
		options.project === undefined
			? {
					id: "project-1",
					name: "Widget launch",
					slugId: "widget-launch-0d42ae5d46d0",
				}
			: options.project;
	const status = options.status ?? 500;
	return async (input, init) => {
		const url = urlOf(input);
		const sent = trackerRequest(input, init);
		options.sent?.push(sent);
		if (url.startsWith("https://api.github.com/")) {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (options.github !== undefined) {
				return options.github(input, init);
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return unrecorded(input);
		}
		if (url !== "https://api.linear.app/graphql") {
			return unrecorded(input);
		}
		const body = typeof init?.body === "string" ? init.body : "";
		const query = JSON.parse(body) as {
			query?: string;
			variables?: { after?: string | null };
		};
		if (query.query?.includes("MemberProjects")) {
			if (options.fail === "key") {
				return new Response("unauthorized", { status: 401 });
			}
			return linearJson({
				data: {
					viewer: { id: "viewer-ada" },
					projects: {
						nodes:
							project === null
								? []
								: [
										{
											id: project.id,
											name: project.name,
											slugId: project.slugId,
											updatedAt: "2026-08-18T12:00:00.000Z",
										},
									],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			});
		}
		if (query.query?.includes("viewer")) {
			if (options.fail === "key") {
				return new Response("unauthorized", { status: 401 });
			}
			return linearJson({ data: { viewer: { id: "viewer-ada" } } });
		}
		if (query.query?.includes("TeamStates")) {
			return linearJson({
				data: {
					team: {
						states: { nodes: options.states ?? [] },
					},
				},
			});
		}
		if (query.query?.includes("ProjectByPin")) {
			if (options.fail === "lookup") {
				return new Response("recorded failure", { status });
			}
			return linearJson({
				data: {
					projects: { nodes: project === null ? [] : [project] },
				},
			});
		}
		if (
			query.query?.includes("ProjectIssues") ||
			query.query?.includes("commentCreate") ||
			query.query?.includes("IssueThread")
		) {
			options.requests?.push(body);
		}
		if (query.query?.includes("IssueThread")) {
			const id = (query as { variables?: { id?: string } }).variables?.id;
			const issue = (options.issues ?? []).find(
				(item) => item.identifier === id || item.id === id,
			);
			if (issue === undefined) {
				return linearJson({
					data: { issue: null },
					errors: [{ message: "Issue not found" }],
				});
			}
			const comments = issue.comments as
				| { nodes?: Record<string, unknown>[] }
				| undefined;
			return linearJson({
				data: {
					issue: {
						identifier: issue.identifier,
						title: issue.title,
						url: `https://linear.app/issue/${String(issue.identifier)}`,
						comments: {
							nodes: (comments?.nodes ?? []).map((comment) => ({
								url: `https://linear.app/issue/${String(issue.identifier)}#${String(comment.id)}`,
								parent: null,
								...comment,
							})),
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		if (query.query?.includes("commentCreate")) {
			if (options.fail === "reply") {
				return linearJson({
					data: null,
					errors: [{ message: "Issue not found" }],
				});
			}
			const input = (
				query as {
					variables?: {
						input?: { issueId?: string; body?: string; parentId?: string };
					};
				}
			).variables?.input;
			const issue = (options.issues ?? []).find(
				(item) =>
					item.identifier === input?.issueId || item.id === input?.issueId,
			);
			const comments = issue?.comments as
				| { nodes?: Record<string, unknown>[] }
				| undefined;
			comments?.nodes?.push({
				id: "comment-created",
				body: input?.body ?? "",
				createdAt: "2026-08-18T13:00:00.000Z",
				url: "https://linear.app/issue/PF-1#comment-created",
				...(input?.parentId === undefined
					? {}
					: { parent: { id: input.parentId } }),
				user: { name: "Lev" },
			});
			return linearJson({
				data: {
					commentCreate: {
						success: true,
						comment: {
							id: "comment-created",
							body: input?.body ?? "",
							createdAt: "2026-08-18T13:00:00.000Z",
							url: "https://linear.app/issue/PF-1#comment-created",
						},
					},
				},
			});
		}
		if (options.fail === "issues") {
			return new Response("recorded failure", { status });
		}
		const after = query.variables?.after ?? null;
		const pages = options.pages;
		if (pages !== undefined) {
			const pageIndex =
				after === null
					? 0
					: pages.findIndex(
							(_page, index) => pages[index - 1]?.endCursor === after,
						);
			const page = pages[pageIndex];
			if (page === undefined) {
				return new Response("not recorded", { status: 404 });
			}
			return linearJson({
				data: {
					issues: {
						nodes: page.nodes,
						pageInfo: {
							hasNextPage: page.endCursor !== null,
							endCursor: page.endCursor,
						},
					},
				},
			});
		}
		return linearJson({
			data: {
				issues: {
					nodes: options.issues ?? [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	};
}
