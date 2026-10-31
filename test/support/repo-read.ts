import type { Fetch } from "../../src/fetch.ts";
import { urlOf } from "./fetch.ts";

export const emptyConnection = {
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

export function repoReadIssues(
	owner: string,
	name: string,
	issues: Record<string, unknown>[],
	options?: {
		pulls?: Record<string, unknown>[];
		mergedPulls?: Record<string, unknown>[];
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
				mergedPullRequests: {
					...emptyConnection,
					nodes: options?.mergedPulls ?? [],
				},
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
					createdAt?: unknown;
					updatedAt?: unknown;
					user?: { login?: unknown } | null;
				};
				return [
					{
						databaseId: typeof row.id === "number" ? row.id : index + 1,
						body: row.body ?? "",
						createdAt: row.created_at ?? row.createdAt ?? updated,
						updatedAt:
							row.updated_at ??
							row.updatedAt ??
							row.created_at ??
							row.createdAt ??
							updated,
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
		Record<string, Record<string, unknown>[]> | undefined;
	const parentUrl =
		typeof item.parent_issue_url === "string" ? item.parent_issue_url : "";
	const parentMatch =
		parentUrl.match(/\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)/) ??
		parentUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
	const dependencyRows = Array.isArray(item.dependencyRows)
		? item.dependencyRows
		: [];
	const blockingRows = Array.isArray(item.blockingRows)
		? item.blockingRows
		: [];
	const relationNodes = (rows: unknown[]) =>
		rows.flatMap((row) => {
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
		});
	const blocked = relationNodes(dependencyRows);
	return {
		number: item.number,
		title: item.title ?? `Ticket ${item.number}`,
		url: item.html_url ?? item.url,
		state: state === "CLOSED" || state === "OPEN" ? state : "OPEN",
		stateReason:
			item.stateReason ??
			(typeof item.state_reason === "string"
				? item.state_reason.toUpperCase()
				: null),
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
				: parentMatch?.[1] === undefined || parentMatch[2] === undefined
					? null
					: {
							number: Number(parentMatch[2]),
							repository: { nameWithOwner: parentMatch[1] },
							title:
								pool?.[parentMatch[1]]?.find(
									(row: { number?: unknown }) =>
										row.number === Number(parentMatch[2]),
								)?.title ?? null,
						},
		blockedBy: {
			nodes: blocked,
			pageInfo: { hasNextPage: false, endCursor: null },
		},
		blocking: {
			nodes: relationNodes(blockingRows),
			pageInfo: { hasNextPage: false, endCursor: null },
		},
	};
}

const checkStatusGraphql: Record<string, string> = {
	completed: "COMPLETED",
	in_progress: "IN_PROGRESS",
	pending: "PENDING",
	queued: "QUEUED",
	requested: "REQUESTED",
	waiting: "WAITING",
};

const checkConclusionGraphql: Record<string, string> = {
	action_required: "ACTION_REQUIRED",
	cancelled: "CANCELLED",
	failure: "FAILURE",
	neutral: "NEUTRAL",
	skipped: "SKIPPED",
	stale: "STALE",
	startup_failure: "STARTUP_FAILURE",
	success: "SUCCESS",
	timed_out: "TIMED_OUT",
};

const reviewStateGraphql: Record<string, string> = {
	approved: "APPROVED",
	changes_requested: "CHANGES_REQUESTED",
	commented: "COMMENTED",
	dismissed: "DISMISSED",
	pending: "PENDING",
};

const reactionContentGraphql: Record<string, string> = {
	confused: "CONFUSED",
	eyes: "EYES",
	heart: "HEART",
	hooray: "HOORAY",
	laugh: "LAUGH",
	rocket: "ROCKET",
	"-1": "THUMBS_DOWN",
	"+1": "THUMBS_UP",
	thumbs_down: "THUMBS_DOWN",
	thumbs_up: "THUMBS_UP",
};

function connectionOf(nodes: Record<string, unknown>[]): {
	nodes: Record<string, unknown>[];
	pageInfo: { hasNextPage: false; endCursor: null };
} {
	return { nodes, pageInfo: { hasNextPage: false, endCursor: null } };
}

function rowsOf(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) =>
		item !== null && typeof item === "object"
			? [item as Record<string, unknown>]
			: [],
	);
}

export function githubPullNode(
	item: Record<string, unknown>,
): Record<string, unknown> {
	const head = item.head as { ref?: string; sha?: string } | undefined;
	const base = item.base as { ref?: string } | undefined;
	const mergedAt = item.merged_at ?? item.mergedAt ?? null;
	const headOid = head?.sha ?? item.headRefOid ?? "a".repeat(40);
	const reviewNodes = rowsOf(item.reviewRows).flatMap((row) => {
		const login = (row.user as { login?: unknown } | null)?.login;
		if (typeof login !== "string") {
			return [];
		}
		const state =
			reviewStateGraphql[String(row.state ?? "").toLowerCase()] ?? "COMMENTED";
		return [
			{
				author: { login },
				commit: { oid: String(row.commit_id ?? headOid) },
				state,
			},
		];
	});
	const commentNodes = rowsOf(item.commentRows).flatMap((row) => {
		const login = (row.user as { login?: unknown } | null)?.login;
		if (typeof login !== "string") {
			return [];
		}
		const reactions = row.reactions as { total_count?: unknown } | undefined;
		return [
			{
				author: { login },
				body: row.body ?? "",
				createdAt: row.created_at ?? null,
				reactions: {
					totalCount:
						typeof reactions?.total_count === "number"
							? reactions.total_count
							: 0,
				},
			},
		];
	});
	const reactionNodes = rowsOf(item.reactionRows).flatMap((row) => {
		const login = (row.user as { login?: unknown } | null)?.login;
		const content =
			reactionContentGraphql[String(row.content ?? "").toLowerCase()];
		if (typeof login !== "string" || content === undefined) {
			return [];
		}
		return [
			{
				user: { login },
				content,
				createdAt: row.created_at ?? null,
			},
		];
	});
	const checkNodes = rowsOf(item.checkRows).flatMap((row) => {
		const status = checkStatusGraphql[String(row.status ?? "").toLowerCase()];
		if (typeof row.name !== "string" || status === undefined) {
			return [];
		}
		const conclusion =
			row.conclusion === null
				? null
				: checkConclusionGraphql[String(row.conclusion ?? "").toLowerCase()];
		return [
			{
				name: row.name,
				status,
				...(conclusion === undefined ? {} : { conclusion }),
			},
		];
	});
	const committed = item.committedAt;
	return {
		number: item.number,
		title: item.title ?? `PR ${item.number}`,
		url: item.html_url ?? item.url ?? "",
		isDraft: item.draft === true || item.isDraft === true,
		body: item.body ?? "",
		state:
			mergedAt !== null
				? "MERGED"
				: String(item.state ?? "open").toUpperCase() === "CLOSED"
					? "CLOSED"
					: "OPEN",
		mergedAt,
		headRefName: head?.ref ?? item.headRefName ?? `${item.number}-feat`,
		...(base?.ref === undefined ? {} : { baseRefName: base.ref }),
		headRefOid: headOid,
		...(typeof committed === "string"
			? {
					commits: connectionOf([{ commit: { committedDate: committed } }]),
				}
			: {}),
		closingIssuesReferences: {
			nodes: Array.isArray(item.closing)
				? (item.closing as { number?: number }[]).flatMap((node) =>
						typeof node.number === "number" ? [{ number: node.number }] : [],
					)
				: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		},
		reviews: connectionOf(reviewNodes),
		comments: connectionOf(commentNodes),
		reactions: connectionOf(reactionNodes),
		...(checkNodes.length === 0
			? {}
			: { statusCheckRollup: { contexts: connectionOf(checkNodes) } }),
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

export async function issueList(
	handler: Fetch,
	repo: string,
): Promise<Response> {
	const bare = `https://api.github.com/repos/${repo}/issues`;
	const paged = `${bare}?state=all&per_page=100&page=1`;
	const first = await handler(paged, { method: "GET" });
	if (first.ok || first.status === 304) {
		return first;
	}
	return handler(bare, { method: "GET" });
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
		try {
			const rest: Fetch = async (restInput, restInit) => {
				const restBody =
					typeof restInit?.body === "string" ? restInit.body : "";
				if (
					urlOf(restInput) === "https://api.github.com/graphql" &&
					restBody.includes("query RepoRead")
				) {
					return new Response("[]", { status: 404 });
				}
				let response: Response;
				try {
					response = await handler(restInput, restInit);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "recorded page failed";
					return new Response(JSON.stringify({ errors: [{ message }] }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (response.status === 304) {
					return response;
				}
				if (!response.ok && response.status !== 404) {
					throw new Error(
						`recorded page ${response.status} ${urlOf(restInput)}`,
					);
				}
				return response;
			};
			const issuesResponse = await issueList(handler, repo);
			if (!issuesResponse.ok && issuesResponse.status !== 304) {
				return new Response(await issuesResponse.text(), {
					status: issuesResponse.status,
					headers: issuesResponse.headers,
				});
			}
			if (issuesResponse.status === 304) {
				const etag = issuesResponse.headers.get("etag");
				return new Response(null, {
					status: 304,
					headers: etag === null ? {} : { etag },
				});
			}
			const nextIssues = issuesResponse.headers
				.get("link")
				?.match(/<([^>]+)>; rel="next"/)?.[1];
			const nextIssuesResponse =
				nextIssues === undefined
					? null
					: await rest(nextIssues, { method: "GET" });
			const pullsResponse = await rest(
				`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`,
				{ method: "GET" },
			);
			const mergedResponse = await rest(
				`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`,
				{ method: "GET" },
			);
			const branchesResponse = await rest(
				`https://api.github.com/repos/${repo}/branches?per_page=100&page=1`,
				{ method: "GET" },
			);
			const nextBranches = branchesResponse.headers
				.get("link")
				?.match(/<([^>]+)>; rel="next"/)?.[1];
			const nextBranchesResponse =
				nextBranches === undefined
					? null
					: await rest(nextBranches, { method: "GET" });
			const labelsResponse = await handler(
				`https://api.github.com/repos/${repo}/labels?per_page=100&page=1`,
				{ method: "GET" },
			);
			const firstIssues =
				issuesResponse.ok && issuesResponse.status !== 304
					? ((await issuesResponse.json()) as Record<string, unknown>[])
					: [];
			const laterIssues =
				nextIssuesResponse?.ok === true
					? ((await nextIssuesResponse.json()) as Record<string, unknown>[])
					: [];
			const issues = [
				...(Array.isArray(firstIssues) ? firstIssues : []),
				...(Array.isArray(laterIssues) ? laterIssues : []),
			];
			const openPulls =
				pullsResponse.ok && pullsResponse.status !== 304
					? ((await pullsResponse.json()) as Record<string, unknown>[])
					: [];
			const mergedPulls =
				mergedResponse.ok && mergedResponse.status !== 304
					? ((await mergedResponse.json()) as Record<string, unknown>[])
					: [];
			const pulls = [
				...(Array.isArray(openPulls) ? openPulls : []),
				...(Array.isArray(mergedPulls) ? mergedPulls : []).filter(
					(pull) => pull.merged_at != null || pull.mergedAt != null,
				),
			];
			const firstBranches =
				branchesResponse.ok && branchesResponse.status !== 304
					? ((await branchesResponse.json()) as { name?: string }[])
					: [];
			const laterBranches =
				nextBranchesResponse?.ok === true && nextBranchesResponse.status !== 304
					? ((await nextBranchesResponse.json()) as { name?: string }[])
					: [];
			const branches = [
				...(Array.isArray(firstBranches) ? firstBranches : []),
				...(Array.isArray(laterBranches) ? laterBranches : []),
			];
			const labels =
				labelsResponse.ok && labelsResponse.status !== 304
					? ((await labelsResponse.json()) as {
							name?: string;
							color?: string;
						}[])
					: [];
			const jsonRows = async (
				url: string,
				required = false,
			): Promise<unknown> => {
				const response = await rest(url, { method: "GET" });
				if (response.status === 304) {
					return [];
				}
				if (!response.ok) {
					if (required) {
						throw new Error(
							`GitHub read repo failed (HTTP ${response.status})`,
						);
					}
					return [];
				}
				const rows = await response.json();
				const next = response.headers
					.get("link")
					?.match(/<([^>]+)>; rel="next"/)?.[1];
				if (next === undefined || !Array.isArray(rows)) {
					return rows;
				}
				const later = await jsonRows(next, true);
				return [...rows, ...(Array.isArray(later) ? later : [])];
			};
			const withComments = await Promise.all(
				(Array.isArray(issues) ? issues : []).map(async (issue) => {
					const rows = await jsonRows(
						`https://api.github.com/repos/${repo}/issues/${issue.number}/comments?per_page=100&page=1`,
					);
					const summary = (
						issue as { issue_dependencies_summary?: { blocked_by?: number } }
					).issue_dependencies_summary;
					const dependencyRows = await jsonRows(
						`https://api.github.com/repos/${repo}/issues/${issue.number}/dependencies/blocked_by?per_page=100&page=1`,
						(summary?.blocked_by ?? 0) > 0,
					);
					const blockingRows = await jsonRows(
						`https://api.github.com/repos/${repo}/issues/${issue.number}/dependencies/blocking?per_page=100&page=1`,
						((summary as { blocking?: number } | undefined)?.blocking ?? 0) > 0,
					);
					return {
						...issue,
						commentRows: Array.isArray(rows) ? rows : [],
						...(Array.isArray(dependencyRows) && dependencyRows.length > 0
							? { dependencyRows }
							: {}),
						...(Array.isArray(blockingRows) && blockingRows.length > 0
							? { blockingRows }
							: {}),
					};
				}),
			);
			const withReviews = await Promise.all(
				(Array.isArray(pulls) ? pulls : []).map(async (pull) => {
					const number = pull.number;
					const sha = (pull.head as { sha?: string } | undefined)?.sha ?? "";
					const [comments, reviews, reactions, checks, commit] =
						await Promise.all([
							jsonRows(
								`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100&page=1`,
							),
							jsonRows(
								`https://api.github.com/repos/${repo}/pulls/${number}/reviews?per_page=100&page=1`,
							),
							jsonRows(
								`https://api.github.com/repos/${repo}/issues/${number}/reactions?per_page=100&page=1`,
							),
							sha === ""
								? Promise.resolve({ check_runs: [] })
								: jsonRows(
										`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
									),
							sha === ""
								? Promise.resolve(null)
								: jsonRows(
										`https://api.github.com/repos/${repo}/commits/${sha}`,
									),
						]);
					const checkRuns = (checks as { check_runs?: unknown } | null)
						?.check_runs;
					const committedAt = (
						commit as {
							commit?: { committer?: { date?: unknown } };
						} | null
					)?.commit?.committer?.date;
					return {
						...pull,
						commentRows: Array.isArray(comments) ? comments : [],
						reviewRows: Array.isArray(reviews) ? reviews : [],
						reactionRows: Array.isArray(reactions) ? reactions : [],
						checkRows: Array.isArray(checkRuns) ? checkRuns : [],
						...(typeof committedAt === "string" ? { committedAt } : {}),
					};
				}),
			);
			const page = repoReadFromLists(
				input,
				init,
				{ [repo]: withComments },
				{ [repo]: withReviews },
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
			if (labels.length > 0) {
				payload.data.repository.labels.nodes = labels.flatMap((label) =>
					typeof label.name === "string"
						? [{ name: label.name, color: label.color ?? "ededed" }]
						: [],
				);
			}
			return new Response(JSON.stringify(payload), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "recorded page failed";
			return new Response(JSON.stringify({ errors: [{ message }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
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
	const issues = (issuesByRepo[repo] ?? []).flatMap((item) =>
		item.pull_request === undefined
			? [githubIssueNode({ ...item, parentPool: issuesByRepo })]
			: [],
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
	return new Response("query RepoRead has no repository body", { status: 404 });
}
