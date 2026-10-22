import { z } from "zod";
import {
	heldBlockerIds,
	refreshedBlockers,
	type Ticket,
	type TicketRef,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { dependencyRefs, githubHeaders } from "./github.ts";

const connectionPage = "pageInfo { hasNextPage endCursor }";

const blockerNode = z.object({
	number: z.number(),
	title: z.string().nullable().optional(),
	state: z.string(),
	repository: z.object({ nameWithOwner: z.string() }).nullable().optional(),
});

const blockerPage = z.object({
	nodes: z.array(blockerNode.optional().catch(undefined)),
	pageInfo: z
		.object({
			hasNextPage: z.boolean(),
			endCursor: z.string().nullable(),
		})
		.optional(),
});

function splitRepo(repo: string): { owner: string; name: string } | null {
	const [owner, name] = repo.split("/");
	if (owner === undefined || name === undefined || name === "") {
		return null;
	}
	return { owner, name };
}

async function readBlockerStates(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	numbers: number[],
): Promise<Map<number, z.infer<typeof blockerPage>>> {
	const parts = splitRepo(repo);
	const states = new Map<number, z.infer<typeof blockerPage>>();
	if (parts === null || numbers.length === 0) {
		return states;
	}
	const page = 40;
	for (let start = 0; start < numbers.length; start += page) {
		const slice = numbers.slice(start, start + page);
		const collected = slice.map(() => [] as z.infer<typeof blockerNode>[]);
		let cursors: (string | null)[] = slice.map(() => null);
		let pending = true;
		while (pending) {
			const afterNames = slice.map((_, index) => `$after${index}: String`);
			const variableNames = `$owner: String!, $name: String!, ${afterNames.join(", ")}`;
			const blockedByArgs = "first: 20, after: $after";
			const fields = slice
				.map((number, index) => {
					const args = blockedByArgs.replace("$after", `$after${index}`);
					return `i${index}: issue(number: ${number}) { blockedBy(${args}) { nodes { number title state repository { nameWithOwner } } ${connectionPage} } }`;
				})
				.join("\n");
			const variables: Record<string, string | null> = {
				owner: parts.owner,
				name: parts.name,
			};
			for (const [index, cursor] of cursors.entries()) {
				variables[`after${index}`] = cursor;
			}
			const response = await fetchImpl("https://api.github.com/graphql", {
				method: "POST",
				headers: githubHeaders(token),
				body: JSON.stringify({
					query: `query BlockerStates(${variableNames}) { repository(owner: $owner, name: $name) { ${fields} } }`,
					variables,
				}),
			});
			if (!response.ok) {
				throw new Error(
					`GitHub read repo failed (HTTP ${response.status}): ${repo}`,
				);
			}
			const parsed = z
				.object({
					data: z.object({
						repository: z
							.record(
								z.string(),
								z.object({ blockedBy: blockerPage }).nullable(),
							)
							.nullable(),
					}),
					errors: z.array(z.object({ message: z.string() })).optional(),
				})
				.safeParse(await response.json());
			const repository = parsed.success ? parsed.data.data.repository : null;
			if (
				!parsed.success ||
				parsed.data.errors?.[0] !== undefined ||
				repository === null
			) {
				throw new Error(`GitHub read repo failed: ${repo}`);
			}
			const next: (string | null)[] = [];
			slice.forEach((number, index) => {
				const node = repository[`i${index}`];
				if (node === undefined || node === null) {
					next.push(null);
					return;
				}
				collected[index]?.push(
					...node.blockedBy.nodes.flatMap((item) =>
						item === undefined ? [] : [item],
					),
				);
				const cursor = node.blockedBy.pageInfo?.endCursor ?? null;
				next.push(
					node.blockedBy.pageInfo?.hasNextPage === true && cursor !== null
						? cursor
						: null,
				);
				states.set(number, {
					nodes: collected[index] ?? [],
					pageInfo: { hasNextPage: false, endCursor: null },
				});
			});
			cursors = next;
			pending = cursors.some((cursor) => cursor !== null);
		}
	}
	return states;
}

function refsOf(page: z.infer<typeof blockerPage>, repo: string): TicketRef[] {
	return dependencyRefs(
		page.nodes.flatMap((node) => (node === undefined ? [] : [node])),
		repo,
	);
}

/** A closed blocker does not change the blocked ticket, so a since read omits it. */
export async function currentBlockers(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	listed: Ticket[],
	held: Ticket[],
): Promise<Ticket[]> {
	const ids = heldBlockerIds(held);
	if (ids.length === 0) {
		return listed;
	}
	const states = await readBlockerStates(token, fetchImpl, repo, ids);
	const refsById = new Map(
		[...states].map(([id, page]) => [id, refsOf(page, repo)]),
	);
	return refreshedBlockers(listed, held, refsById);
}
