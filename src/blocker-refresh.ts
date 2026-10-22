import { z } from "zod";
import type { Ticket, TicketRef } from "./domain.ts";
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
			const fields = slice
				.map(
					(number, index) =>
						`i${index}: issue(number: ${number}) { blockedBy(first: 20, after: $after${index}) { nodes { number title state repository { nameWithOwner } } ${connectionPage} } }`,
				)
				.join("\n");
			const afterNames = slice.map((_, index) => `$after${index}: String`);
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
					query: `query BlockerStates($owner: String!, $name: String!, ${afterNames.join(", ")}) { repository(owner: $owner, name: $name) { ${fields} } }`,
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
	const stale = held.filter(
		(ticket) =>
			ticket.state === "open" &&
			ticket.key !== null &&
			ticket.blockedBy.length > 0 &&
			Number.isInteger(Number(ticket.id)),
	);
	if (stale.length === 0) {
		return listed;
	}
	const states = await readBlockerStates(
		token,
		fetchImpl,
		repo,
		stale.map((ticket) => Number(ticket.id)),
	);
	const fresh = stale.flatMap((ticket) => {
		const blockedBy = states.get(Number(ticket.id));
		if (blockedBy === undefined) {
			return [];
		}
		const listedTicket = listed.find((item) => item.id === ticket.id);
		const base = listedTicket ?? ticket;
		return [{ ...base, blockedBy: refsOf(blockedBy, repo) }];
	});
	const freshKeys = new Set(
		fresh.flatMap((ticket) => (ticket.key === null ? [] : [ticket.key])),
	);
	return [
		...listed.filter(
			(ticket) => ticket.key === null || !freshKeys.has(ticket.key),
		),
		...fresh,
	];
}
