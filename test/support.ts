import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import type { RunIo } from "../src/main.ts";

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

const emptyConnection = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

export function emptyRepoRead(owner: string, name: string): unknown {
	return {
		data: {
			repository: {
				nameWithOwner: `${owner}/${name}`,
				autoMergeAllowed: false,
				refs: emptyConnection,
				labels: emptyConnection,
				issues: emptyConnection,
				openPullRequests: emptyConnection,
				mergedPullRequests: emptyConnection,
			},
		},
	};
}

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

export function recordedViewer(
	input: string | URL | Request,
	init?: RequestInit,
): Response | null {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	if (urlOf(input) === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	return null;
}

export function repoReadIssues(
	owner: string,
	name: string,
	issues: Record<string, unknown>[],
	options?: {
		pulls?: Record<string, unknown>[];
		edited?: Record<string, unknown>[];
	},
): unknown {
	return {
		data: {
			repository: {
				nameWithOwner: `${owner}/${name}`,
				autoMergeAllowed: false,
				refs: emptyConnection,
				labels: emptyConnection,
				issues: { ...emptyConnection, nodes: issues },
				openPullRequests: { ...emptyConnection, nodes: options?.pulls ?? [] },
				mergedPullRequests: emptyConnection,
			},
			...(options?.edited === undefined
				? {}
				: { editedIssues: { ...emptyConnection, nodes: options.edited } }),
		},
	};
}

export function githubIssueNode(
	item: Record<string, unknown>,
): Record<string, unknown> {
	const updated =
		item.updated_at ?? item.updatedAt ?? "2026-04-01T00:00:00.000Z";
	const state = String(item.state ?? "open").toUpperCase();
	const rawComments = item.commentRows ?? item.reviewComments;
	const commentNodes = Array.isArray(rawComments)
		? rawComments.flatMap((comment, index) => {
				if (comment === null || typeof comment !== "object") {
					return [];
				}
				const row = comment as {
					id?: unknown;
					body?: unknown;
					created_at?: unknown;
					updated_at?: unknown;
					user?: { login?: unknown } | null;
				};
				return [
					{
						databaseId: typeof row.id === "number" ? row.id : index + 1,
						body: row.body ?? "",
						createdAt: row.created_at ?? updated,
						updatedAt: row.updated_at ?? row.created_at ?? updated,
						author:
							row.user?.login === undefined
								? null
								: { login: String(row.user.login) },
						reactions: { totalCount: 0 },
					},
				];
			})
		: [];
	const labels = item.labels;
	const labelNodes = Array.isArray(labels)
		? labels.flatMap((label) => {
				if (typeof label === "string") {
					return [{ name: label, color: "ededed" }];
				}
				if (label !== null && typeof label === "object" && "name" in label) {
					const named = label as { name?: unknown; color?: unknown };
					return [
						{
							name: String(named.name),
							color: typeof named.color === "string" ? named.color : "ededed",
						},
					];
				}
				return [];
			})
		: [];
	const people = item.assignees;
	const assigneeNodes = Array.isArray(people)
		? people.flatMap((person) => {
				if (
					person !== null &&
					typeof person === "object" &&
					"login" in person
				) {
					return [{ login: String((person as { login?: unknown }).login) }];
				}
				return [];
			})
		: item.assignee !== null &&
				typeof item.assignee === "object" &&
				"login" in item.assignee
			? [{ login: String((item.assignee as { login?: unknown }).login) }]
			: [];
	const milestone = item.milestone;
	const parent = item.parent;
	const pool = item.parentPool as
		| Record<string, Record<string, unknown>[]>
		| undefined;
	const parentUrl =
		typeof item.parent_issue_url === "string" ? item.parent_issue_url : "";
	const parentMatch =
		parentUrl.match(/\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)/) ??
		parentUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
	const dependencyRows = Array.isArray(item.dependencyRows)
		? item.dependencyRows
		: [];
	const blocked =
		dependencyRows.length > 0
			? dependencyRows.flatMap((row) => {
					if (row === null || typeof row !== "object") {
						return [];
					}
					const node = row as {
						number?: unknown;
						title?: unknown;
						state?: unknown;
						repository_url?: unknown;
						html_url?: unknown;
					};
					const repoUrl = String(node.repository_url ?? node.html_url ?? "");
					const repoMatch =
						repoUrl.match(/\/repos\/([^/]+\/[^/]+)/) ??
						repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
					return [
						{
							number: node.number,
							title: node.title ?? null,
							state: String(node.state ?? "open").toUpperCase(),
							repository:
								repoMatch === null ? null : { nameWithOwner: repoMatch[1] },
						},
					];
				})
			: typeof item.body === "string"
				? [
						...item.body.matchAll(
							/\*{0,2}_{0,2}(?:Blocked by|blocked by|Blocks)_{0,2}\*{0,2}:\s*#?(\d+)/g,
						),
					].map((match) => ({
						number: Number(match[1]),
						title: null,
						state: "OPEN",
						repository: null,
					}))
				: [];
	return {
		number: item.number,
		title: item.title ?? `Ticket ${item.number}`,
		state: state === "CLOSED" || state === "OPEN" ? state : "OPEN",
		stateReason: item.state_reason ?? item.stateReason ?? null,
		updatedAt: updated,
		createdAt: item.created_at ?? item.createdAt ?? updated,
		closedAt: item.closed_at ?? item.closedAt ?? null,
		body: item.body ?? "",
		comments: { ...emptyConnection, nodes: commentNodes },
		labels: { ...emptyConnection, nodes: labelNodes },
		assignees: { nodes: assigneeNodes },
		milestone:
			milestone !== null &&
			typeof milestone === "object" &&
			"title" in milestone
				? { title: String((milestone as { title?: unknown }).title) }
				: null,
		parent:
			parent !== null && typeof parent === "object" && "number" in parent
				? parent
				: parentMatch === null
					? null
					: {
							number: Number(parentMatch[2]),
							repository: { nameWithOwner: parentMatch[1] },
							title:
								pool?.[parentMatch[1]]?.find(
									(row) => row.number === Number(parentMatch[2]),
								)?.title ?? null,
						},
		blockedBy: {
			nodes: blocked,
			pageInfo: { hasNextPage: false, endCursor: null },
		},
	};
}

export function githubPullNode(
	item: Record<string, unknown>,
): Record<string, unknown> {
	const head = item.head as { ref?: string; sha?: string } | undefined;
	const mergedAt = item.merged_at ?? item.mergedAt ?? null;
	return {
		number: item.number,
		title: item.title ?? `PR ${item.number}`,
		url: item.html_url ?? item.url ?? "",
		isDraft: item.draft === true || item.isDraft === true,
		body: item.body ?? "",
		state:
			String(item.state ?? "open").toUpperCase() === "CLOSED"
				? "CLOSED"
				: "OPEN",
		mergedAt,
		headRefName: head?.ref ?? item.headRefName ?? `${item.number}-feat`,
		headRefOid: head?.sha ?? item.headRefOid ?? "a".repeat(40),
		closingIssuesReferences: {
			nodes: Array.isArray(item.closing)
				? (item.closing as { number?: number }[]).flatMap((node) =>
						typeof node.number === "number" ? [{ number: node.number }] : [],
					)
				: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		},
		reviews: emptyConnection,
		comments: emptyConnection,
		reactions: emptyConnection,
	};
}

export function answerRepoRead(
	input: string | URL | Request,
	init: RequestInit | undefined,
	respond: (
		owner: string,
		name: string,
	) => {
		issues: Record<string, unknown>[];
		pulls?: Record<string, unknown>[];
	} | null,
): Response | null {
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		urlOf(input) !== "https://api.github.com/graphql" ||
		!body.includes("query RepoRead")
	) {
		return null;
	}
	const parsed = JSON.parse(body) as {
		variables?: { owner?: string; name?: string };
	};
	const owner = String(parsed.variables?.owner ?? "");
	const name = String(parsed.variables?.name ?? "");
	const found = respond(owner, name);
	if (found === null) {
		return null;
	}
	return repoReadFromLists(
		input,
		init,
		{ [`${owner}/${name}`]: found.issues },
		{
			[`${owner}/${name}`]: found.pulls ?? [],
		},
	);
}

export function repoReadFromHandler(
	input: string | URL | Request,
	init: RequestInit | undefined,
	handler: Fetch,
): Promise<Response | null> {
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		urlOf(input) !== "https://api.github.com/graphql" ||
		!body.includes("query RepoRead")
	) {
		return Promise.resolve(null);
	}
	const parsed = JSON.parse(body) as {
		variables?: { owner?: string; name?: string };
	};
	const owner = String(parsed.variables?.owner ?? "acme");
	const name = String(parsed.variables?.name ?? "widget");
	const repo = `${owner}/${name}`;
	return (async () => {
		const rest: Fetch = async (restInput, restInit) => {
			const restBody = typeof restInit?.body === "string" ? restInit.body : "";
			if (
				urlOf(restInput) === "https://api.github.com/graphql" &&
				restBody.includes("query RepoRead")
			) {
				return new Response("[]", { status: 404 });
			}
			return handler(restInput, restInit);
		};
		const issuesResponse = await rest(
			`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`,
			{ method: "GET" },
		);
		const pullsResponse = await rest(
			`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`,
			{ method: "GET" },
		);
		const branchesResponse = await rest(
			`https://api.github.com/repos/${repo}/branches?per_page=100&page=1`,
			{ method: "GET" },
		);
		const labelsResponse = await rest(
			`https://api.github.com/repos/${repo}/labels?per_page=100&page=1`,
			{ method: "GET" },
		);
		const issues = issuesResponse.ok
			? ((await issuesResponse.json()) as Record<string, unknown>[])
			: [];
		const pulls = pullsResponse.ok
			? ((await pullsResponse.json()) as Record<string, unknown>[])
			: [];
		const branches = branchesResponse.ok
			? ((await branchesResponse.json()) as { name?: string }[])
			: [];
		const labels = labelsResponse.ok
			? ((await labelsResponse.json()) as { name?: string; color?: string }[])
			: [];
		const withComments = await Promise.all(
			(Array.isArray(issues) ? issues : []).map(async (issue) => {
				const comments = await rest(
					`https://api.github.com/repos/${repo}/issues/${issue.number}/comments?per_page=100&page=1`,
					{ method: "GET" },
				);
				const rows = comments.ok ? await comments.json() : [];
				return {
					...issue,
					commentRows: Array.isArray(rows) ? rows : [],
				};
			}),
		);
		const page = repoReadFromLists(
			input,
			init,
			{ [repo]: withComments },
			{ [repo]: Array.isArray(pulls) ? pulls : [] },
		);
		if (page === null) {
			return null;
		}
		const payload = (await page.json()) as {
			data: {
				repository: {
					refs: { nodes: { name: string }[] };
					labels: { nodes: { name: string; color: string }[] };
				};
			};
		};
		payload.data.repository.refs.nodes = (
			Array.isArray(branches) ? branches : []
		).flatMap((branch) =>
			typeof branch.name === "string" ? [{ name: branch.name }] : [],
		);
		payload.data.repository.labels.nodes = (
			Array.isArray(labels) ? labels : []
		).flatMap((label) =>
			typeof label.name === "string"
				? [{ name: label.name, color: label.color ?? "ededed" }]
				: [],
		);
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	})();
}

export function repoReadFromLists(
	input: string | URL | Request,
	init: RequestInit | undefined,
	issuesByRepo: Record<string, Record<string, unknown>[]>,
	pullsByRepo: Record<string, Record<string, unknown>[]> = {},
): Response | null {
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		urlOf(input) !== "https://api.github.com/graphql" ||
		!body.includes("query RepoRead")
	) {
		return null;
	}
	const parsed = JSON.parse(body) as {
		variables?: { owner?: string; name?: string };
	};
	const owner = parsed.variables?.owner ?? "acme";
	const name = parsed.variables?.name ?? "widget";
	const repo = `${owner}/${name}`;
	const issues = (issuesByRepo[repo] ?? []).map((item) =>
		githubIssueNode({ ...item, parentPool: issuesByRepo }),
	);
	const pulls = (pullsByRepo[repo] ?? []).map((item) => githubPullNode(item));
	const open = pulls.filter(
		(pull) => pull.mergedAt == null && pull.state !== "MERGED",
	);
	const merged = pulls.filter((pull) => pull.mergedAt != null);
	return new Response(
		JSON.stringify({
			data: {
				repository: {
					nameWithOwner: repo,
					autoMergeAllowed: false,
					refs: emptyConnection,
					labels: emptyConnection,
					issues: { ...emptyConnection, nodes: issues },
					openPullRequests: { ...emptyConnection, nodes: open },
					mergedPullRequests: { ...emptyConnection, nodes: merged },
				},
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

export function repoReadResponse(
	input: string | URL | Request,
	init?: RequestInit,
): Response | null {
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		urlOf(input) !== "https://api.github.com/graphql" ||
		!body.includes("query RepoRead")
	) {
		return null;
	}
	const parsed = JSON.parse(body) as {
		variables?: { owner?: string; name?: string };
	};
	return new Response(
		JSON.stringify(
			emptyRepoRead(
				parsed.variables?.owner ?? "acme",
				parsed.variables?.name ?? "widget",
			),
		),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

export function unrecorded(
	input: string | URL | Request,
	init?: RequestInit,
): Response {
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("query RepoRead")
	) {
		const parsed = JSON.parse(body) as {
			variables?: { owner?: string; name?: string };
		};
		return new Response(
			JSON.stringify(
				emptyRepoRead(
					parsed.variables?.owner ?? "acme",
					parsed.variables?.name ?? "widget",
				),
			),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	const read = repoReadResponse(input, init);
	if (read !== null) {
		return read;
	}
	if (
		/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/labels\?/.test(url) ||
		/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/issues\/comments\?/.test(
			url,
		)
	) {
		return new Response("[]", {
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
			const sent = trackerRequest(input, init);
			if (
				options.github !== undefined &&
				sent.query.includes("query RepoRead") &&
				options.issues !== undefined
			) {
				const owner = String(sent.variables.owner ?? "acme");
				const name = String(sent.variables.name ?? "widget");
				const pulls = options.issues.flatMap((issue) => {
					const attachments = issue.attachments as
						| { nodes?: { url?: string; title?: string }[] }
						| undefined;
					return (attachments?.nodes ?? []).flatMap((node) => {
						const match = node.url?.match(
							/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
						);
						if (
							match === null ||
							match === undefined ||
							`${match[1]}/${match[2]}` !== `${owner}/${name}`
						) {
							return [];
						}
						return [
							{
								number: Number(match[3]),
								title: node.title ?? `PR ${match[3]}`,
								url: node.url,
								isDraft: false,
								body: "",
								state: "OPEN",
								mergedAt: null,
								headRefName: `${match[3]}-feat`,
								headRefOid: "a".repeat(40),
								closingIssuesReferences: emptyConnection,
								reviews: emptyConnection,
								comments: emptyConnection,
								reactions: emptyConnection,
							},
						];
					});
				});
				if (pulls.length > 0 && options.github === undefined) {
					return new Response(
						JSON.stringify(repoReadIssues(owner, name, [], { pulls })),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
			}
			if (options.github !== undefined) {
				if (sent.query.includes("query RepoRead")) {
					const owner = String(sent.variables.owner ?? "acme");
					const name = String(sent.variables.name ?? "widget");
					const rest = await options.github(
						`https://api.github.com/repos/${owner}/${name}/issues?state=all&per_page=100&page=1`,
						{ method: "GET" },
					);
					if (rest.ok) {
						const rows = (await rest.json()) as unknown;
						if (Array.isArray(rows)) {
							const withDeps = await Promise.all(
								rows.map(async (item) => {
									const number = (item as { number?: number }).number;
									if (number === undefined) {
										return item;
									}
									const summary = (
										item as {
											issue_dependencies_summary?: { blocked_by?: number };
										}
									).issue_dependencies_summary;
									if ((summary?.blocked_by ?? 0) === 0) {
										return item;
									}
									const deps = await options.github?.(
										`https://api.github.com/repos/${owner}/${name}/issues/${number}/dependencies/blocked_by?per_page=100&page=1`,
										{ method: "GET" },
									);
									if (deps === undefined || !deps.ok) {
										return item;
									}
									const nodes = (await deps.json()) as unknown;
									return {
										...(item as Record<string, unknown>),
										dependencyRows: Array.isArray(nodes) ? nodes : [],
									};
								}),
							);
							const page = repoReadIssues(
								owner,
								name,
								withDeps.map((item) =>
									githubIssueNode(item as Record<string, unknown>),
								),
							) as {
								data: {
									repository: { issues: { nodes: Record<string, unknown>[] } };
								};
							};
							page.data.repository.issues.nodes =
								page.data.repository.issues.nodes.map((node, index) => {
									const source = withDeps[index] as
										| { dependencyRows?: unknown }
										| undefined;
									const rows = source?.dependencyRows;
									if (!Array.isArray(rows) || rows.length === 0) {
										return node;
									}
									return {
										...node,
										blockedBy: {
											nodes: rows.flatMap((row) => {
												if (row === null || typeof row !== "object") {
													return [];
												}
												const dep = row as {
													number?: unknown;
													title?: unknown;
													state?: unknown;
													repository_url?: unknown;
												};
												const repoUrl = String(dep.repository_url ?? "");
												const repoMatch = repoUrl.match(
													/\/repos\/([^/]+\/[^/]+)/,
												);
												return [
													{
														number: dep.number,
														title: dep.title ?? null,
														state: String(dep.state ?? "open").toUpperCase(),
														repository:
															repoMatch === null
																? null
																: { nameWithOwner: repoMatch[1] },
													},
												];
											}),
											pageInfo: { hasNextPage: false, endCursor: null },
										},
									};
								});
							return new Response(JSON.stringify(page), {
								status: 200,
								headers: { "content-type": "application/json" },
							});
						}
					}
				}
				return options.github(input, init);
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
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

export async function trackFound(base: string): Promise<void> {
	const settings = (await (
		await fetch(new URL("/api/settings", base))
	).json()) as { projects: { ref: unknown }[] };
	const saved = await fetch(new URL("/api/settings", base), {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			...settings,
			tracked: settings.projects.map((project) => project.ref),
		}),
	});
	if (!saved.ok) {
		throw new Error(`tracking found projects failed: ${await saved.text()}`);
	}
}
