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

export function testIo(io: RunIo): RunIo {
	return {
		listTodos: async () => "",
		...io,
	};
}

export type LinearFake = {
	project?: { id: string; name: string; slugId: string } | null;
	issues?: Record<string, unknown>[];
	pages?: { nodes: Record<string, unknown>[]; endCursor: string | null }[];
	fail?: "lookup" | "issues" | "key";
	status?: number;
	requests?: string[];
	github?: Fetch;
};

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
		if (url.startsWith("https://api.github.com/")) {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (options.github !== undefined) {
				return options.github(input, init);
			}
			return new Response("not recorded", { status: 404 });
		}
		if (url !== "https://api.linear.app/graphql") {
			return new Response("not recorded", { status: 404 });
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
		if (query.query?.includes("ProjectIssues")) {
			options.requests?.push(body);
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
