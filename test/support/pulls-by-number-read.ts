import type { Fetch } from "../../src/fetch.ts";
import { githubPullNode, pullWithRows, restReader } from "./repo-read.ts";

/** A node id for a recorded issue or PR, which names its repo and number. */
export function recordedId(
	kind: "issue" | "pull",
	repo: string,
	number: unknown,
) {
	return `${kind}:${repo}#${String(number)}`;
}

/** The rows of a recorded commit status list, or none when the commit has no recorded status. */
async function statusRows(
	fetchImpl: Fetch,
	repo: string,
	sha: string,
): Promise<unknown[]> {
	const answered = await fetchImpl(
		`https://api.github.com/repos/${repo}/commits/${sha}/status?per_page=100`,
		{ method: "GET" },
	);
	const payload: unknown = answered.ok
		? await answered.json().catch(() => null)
		: null;
	const statuses =
		typeof payload === "object" && payload !== null && "statuses" in payload
			? payload.statuses
			: null;
	return Array.isArray(statuses) ? statuses : [];
}

/**
 * Answers each alias of a `PullsByNumber` read from the recorded REST PR and its
 * lists. A failed recording becomes a null alias with an error on its path, as
 * GitHub reports a PR that it cannot find.
 */
export async function answerPullsByNumber(
	fetchImpl: Fetch,
	body: string,
): Promise<Response> {
	const variables =
		(JSON.parse(body) as { variables?: Record<string, unknown> }).variables ??
		{};
	const { jsonRows } = restReader(fetchImpl);
	const data: Record<string, unknown> = {};
	const errors: { message: string; path: string[] }[] = [];
	for (const [name, number] of Object.entries(variables)) {
		const at = name.match(/^number(\d+)$/)?.[1];
		if (at === undefined) {
			continue;
		}
		const alias = `p${at}`;
		const repo = `${String(variables[`owner${at}`])}/${String(variables[`name${at}`])}`;
		try {
			const answered = await fetchImpl(
				`https://api.github.com/repos/${repo}/pulls/${String(number)}`,
				{ method: "GET" },
			);
			if (!answered.ok) {
				throw new Error(`recorded pull failed (HTTP ${answered.status})`);
			}
			const pull = (await answered.json()) as Record<string, unknown>;
			const open =
				pull.state === "open" && pull.merged_at == null && pull.draft !== true;
			const sha = (pull.head as { sha?: string } | undefined)?.sha ?? "";
			const rows = open
				? {
						...(await pullWithRows(jsonRows, repo, pull)),
						statusRows: await statusRows(fetchImpl, repo, sha),
					}
				: pull;
			data[alias] = {
				pullRequest: {
					id: recordedId("pull", repo, pull.number),
					...githubPullNode(rows),
				},
			};
		} catch (error) {
			data[alias] = null;
			errors.push({
				message:
					error instanceof Error ? error.message : "recorded pull failed",
				path: [alias],
			});
		}
	}
	return Response.json(errors.length === 0 ? { data } : { data, errors });
}
