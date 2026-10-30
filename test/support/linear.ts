import type { Fetch } from "../../src/fetch.ts";
import { json, type TrackerRequest, trackerRequest, urlOf } from "./fetch.ts";
import { recordedDiscovery, unrecorded } from "./github.ts";
import {
	emptyConnection,
	githubIssueNode,
	issueList,
	repoReadIssues,
} from "./repo-read.ts";

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
	/** The labels of the workspace. A label with a null team is a workspace label. */
	labels?: { id: string; name: string; team: { id: string } | null }[];
	pages?: { nodes: Record<string, unknown>[]; endCursor: string | null }[];
	fail?: "lookup" | "issues" | "key" | "reply";
	status?: number;
	requests?: string[];
	sent?: TrackerRequest[];
	github?: Fetch;
};

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
						{ nodes?: { url?: string; title?: string }[] } | undefined;
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
					const rest = await issueList(options.github, `${owner}/${name}`);
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
									const next = deps.headers
										.get("link")
										?.match(/<([^>]+)>; rel="next"/)?.[1];
									const nextPage =
										next === undefined
											? null
											: await options.github?.(next, { method: "GET" });
									const nextNodes =
										nextPage?.ok === true ? await nextPage.json() : [];
									return {
										...(item as Record<string, unknown>),
										dependencyRows: [
											...(Array.isArray(nodes) ? nodes : []),
											...(Array.isArray(nextNodes) ? nextNodes : []),
										],
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
										{ dependencyRows?: unknown } | undefined;
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
			return json({
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
			return json({ data: { viewer: { id: "viewer-ada" } } });
		}
		if (query.query?.includes("TeamStates")) {
			return json({
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
			return json({
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
		const moved = linearMoveAnswer(body, options);
		if (moved !== null) {
			return moved;
		}
		if (query.query?.includes("IssueThread")) {
			const id = (query as { variables?: { id?: string } }).variables?.id;
			const issue = (options.issues ?? []).find(
				(item) => item.identifier === id || item.id === id,
			);
			if (issue === undefined) {
				return json({
					data: { issue: null },
					errors: [{ message: "Issue not found" }],
				});
			}
			const comments = issue.comments as
				{ nodes?: Record<string, unknown>[] } | undefined;
			return json({
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
				return json({
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
				{ nodes?: Record<string, unknown>[] } | undefined;
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
			return json({
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
			return json({
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
		return json({
			data: {
				issues: {
					nodes: options.issues ?? [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	};
}

type MoveVariables = {
	id?: string;
	labels?: string[];
	input?: {
		stateId?: string;
		addedLabelIds?: string[];
		removedLabelIds?: string[];
	};
};

/** The fake Linear answer to a state move query or mutation in `body`, or null for any other query. */
export function linearMoveAnswer(
	body: string,
	options: LinearFake,
): Response | null {
	const query = JSON.parse(body) as {
		query?: string;
		variables?: MoveVariables;
	};
	const variables = query.variables;
	if (query.query?.includes("ShownStateIds")) {
		const issue = (options.issues ?? []).find(
			(item) => item.identifier === variables?.id || item.id === variables?.id,
		);
		return json({
			data: {
				issue:
					issue === undefined
						? null
						: {
								id: issue.id,
								team: {
									...(issue.team as { id: string } | undefined),
									states: {
										nodes: (options.states ?? []).map(({ id, name }) => ({
											id,
											name,
										})),
									},
								},
							},
				issueLabels: {
					nodes: (options.labels ?? []).filter((label) =>
						variables?.labels?.includes(label.name),
					),
				},
			},
		});
	}
	if (!query.query?.includes("IssueShowState")) {
		return null;
	}
	const input = variables?.input;
	const issue = (options.issues ?? []).find(
		(item) => item.id === variables?.id,
	);
	const state = (options.states ?? []).find(
		(item) => item.id === input?.stateId,
	);
	if (issue === undefined || state === undefined) {
		return json({ data: { issueUpdate: { success: false, issue: null } } });
	}
	const nameOf = (labelId: string) =>
		(options.labels ?? []).find((label) => label.id === labelId)?.name;
	const removed = new Set((input?.removedLabelIds ?? []).map(nameOf));
	const held = (
		(issue.labels as { nodes?: { name: string }[] } | undefined)?.nodes ?? []
	).filter((label) => !removed.has(label.name));
	const added = (input?.addedLabelIds ?? []).flatMap((labelId) => {
		const name = nameOf(labelId);
		return name === undefined ? [] : [{ name }];
	});
	issue.state = {
		id: state.id,
		name: state.name,
		type: state.type,
		color: state.color,
	};
	issue.labels = { nodes: [...held, ...added] };
	return json({
		data: {
			issueUpdate: {
				success: true,
				issue: { state: issue.state, labels: issue.labels },
			},
		},
	});
}
