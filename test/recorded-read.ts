import type { Fetch } from "../src/fetch.ts";
import { repoReadFromHandler, urlOf } from "./support.ts";

function nullRepository(body: unknown): boolean {
	if (typeof body !== "object" || body === null || !("data" in body)) {
		return false;
	}
	const data = body.data;
	return (
		typeof data === "object" &&
		data !== null &&
		"repository" in data &&
		data.repository === null
	);
}

function repositoryBody(body: unknown): boolean {
	if (typeof body !== "object" || body === null || !("data" in body)) {
		return false;
	}
	const data = body.data;
	return (
		typeof data === "object" &&
		data !== null &&
		"repository" in data &&
		typeof data.repository === "object" &&
		data.repository !== null &&
		"nameWithOwner" in data.repository
	);
}

async function blockerStatesFromHandler(
	body: string,
	handler: Fetch,
): Promise<Response | null> {
	const parsed = JSON.parse(body) as {
		query?: string;
		variables?: { owner?: string; name?: string };
	};
	const owner = parsed.variables?.owner;
	const name = parsed.variables?.name;
	if (
		owner === undefined ||
		name === undefined ||
		owner === "" ||
		name === ""
	) {
		return null;
	}
	const repo = `${owner}/${name}`;
	const aliases = [
		...(parsed.query ?? "").matchAll(/i(\d+): issue\(number: (\d+)\)/g),
	];
	const repository: Record<string, unknown> = {};
	for (const match of aliases) {
		const index = match[1];
		const number = match[2];
		if (index === undefined || number === undefined) {
			continue;
		}
		const response = await handler(
			`https://api.github.com/repos/${repo}/issues/${number}/dependencies/blocked_by?per_page=100&page=1`,
			{ method: "GET" },
		);
		if (!response.ok) {
			return null;
		}
		const rows = (await response.json()) as Record<string, unknown>[];
		repository[`i${index}`] = {
			blockedBy: {
				nodes: (Array.isArray(rows) ? rows : []).flatMap((row) => {
					const repoUrl = String(row.repository_url ?? row.html_url ?? "");
					const repoMatch = repoUrl.match(/\/repos\/([^/]+\/[^/]+)/);
					return [
						{
							number: row.number,
							title: row.title ?? null,
							state: String(row.state ?? "open").toUpperCase(),
							repository:
								repoMatch?.[1] === undefined
									? { nameWithOwner: repo }
									: { nameWithOwner: repoMatch[1] },
						},
					];
				}),
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		};
	}
	return Response.json({ data: { repository } });
}

export function answerRecordedRepoRead(fetchImpl: Fetch): Fetch {
	const wrapped: Fetch = async (input, init) => {
		const body = typeof init?.body === "string" ? init.body : "";
		const answered = await fetchImpl(input, init);
		if (urlOf(input) !== "https://api.github.com/graphql") {
			return answered;
		}
		if (body.includes("query BlockerStates")) {
			const states = await blockerStatesFromHandler(body, fetchImpl);
			return states ?? answered;
		}
		if (!body.includes("query RepoRead")) {
			return answered;
		}
		if (!answered.ok) {
			if (answered.status !== 404) {
				return answered;
			}
		} else {
			const payload: unknown = await answered
				.clone()
				.json()
				.catch(() => null);
			if (repositoryBody(payload) || nullRepository(payload)) {
				return answered;
			}
		}
		try {
			const read = await repoReadFromHandler(input, init, fetchImpl);
			return read ?? answered;
		} catch {
			return answered;
		}
	};
	if (fetchImpl.holdLists !== undefined) {
		wrapped.holdLists = () => fetchImpl.holdLists?.() ?? Promise.resolve();
	}
	return wrapped;
}
