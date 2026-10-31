import { z } from "zod";

import type { PullRequest } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	type ForgejoAccess,
	type ForgejoClient,
	forgejoClient,
	type ForgejoPull,
	forgejoPull,
	isRejected,
	readCommittedAt,
	readEvidence,
	type ReviewEvidence,
} from "./forgejo-api.ts";
import type { Forge, PullLink } from "./ports.ts";
import { numberedKey } from "./ticket-key.ts";

/** The client of one forge, and the review evidence of each merged PR that it read. */
type Reads = {
	client: ForgejoClient;
	merged: Map<string, ReviewEvidence>;
};

type Listed = { pull: ForgejoPull; closingKeys: string[] };

const noEvidence: ReviewEvidence = {
	checks: [],
	comments: [],
	reviews: [],
	reactions: [],
};

async function pullOf(
	reads: Reads,
	repo: string,
	{ pull, closingKeys }: Listed,
): Promise<PullRequest> {
	const draft = pull.draft === true;
	const key = numberedKey(repo, pull.number);
	const evidence =
		reads.merged.get(key) ??
		(draft ? noEvidence : await readEvidence(reads.client, repo, pull));
	if (pull.merged) {
		reads.merged.set(key, evidence);
	}
	return {
		repo,
		number: pull.number,
		url: pull.html_url,
		title: pull.title,
		draft,
		branch: pull.head.ref,
		body: pull.body ?? "",
		closingKeys,
		headSha: pull.merged ? "" : pull.head.sha,
		headCommittedAt:
			pull.merged || draft
				? null
				: await readCommittedAt(reads.client, repo, pull.head.sha),
		merged: pull.merged,
		...evidence,
	};
}

/** A read that failed for any cause but a rejected token, which fails the poll of the project. */
function skipUnlessRejected(error: unknown): null {
	if (isRejected(error)) {
		throw error;
	}
	return null;
}

/** Each PR in order. A PR that fails to read is left out until the next poll. */
async function pullsOf(
	reads: Reads,
	repo: string,
	listed: Listed[],
): Promise<PullRequest[]> {
	const pulls: PullRequest[] = [];
	for (const item of listed) {
		const read = await pullOf(reads, repo, item).catch(skipUnlessRejected);
		if (read !== null) {
			pulls.push(read);
		}
	}
	return pulls;
}

const unlinked = (pull: ForgejoPull): Listed => ({ pull, closingKeys: [] });

async function mergedHistory(
	reads: Reads,
	repo: string,
): Promise<PullRequest[]> {
	const response = await reads.client
		.get(
			`${reads.client.api}/repos/${repo}/pulls?state=closed&limit=10`,
			"list pulls",
		)
		.catch(skipUnlessRejected);
	if (response === null) {
		return [];
	}
	const closed = z.array(forgejoPull).parse(await response.json());
	return pullsOf(
		reads,
		repo,
		closed.filter((pull) => pull.merged).map(unlinked),
	);
}

/** The open or merged PR of each link, once, with the key of each ticket that links it. */
async function linkedPulls(
	reads: Reads,
	links: PullLink[],
): Promise<PullRequest[]> {
	const targets = new Map<string, PullLink & { closingKeys: string[] }>();
	for (const link of links) {
		const key = numberedKey(link.repo, link.number);
		const target = targets.get(key) ?? { ...link, closingKeys: [] };
		if (!target.closingKeys.includes(link.ticketKey)) {
			target.closingKeys.push(link.ticketKey);
		}
		targets.set(key, target);
	}
	const pulls: PullRequest[] = [];
	for (const { repo, number, closingKeys } of targets.values()) {
		const pull = await reads.client
			.get(`${reads.client.api}/repos/${repo}/pulls/${number}`, "read pull")
			.then(async (response) => forgejoPull.parse(await response.json()))
			.catch(skipUnlessRejected);
		if (pull !== null && (pull.state === "open" || pull.merged)) {
			pulls.push(...(await pullsOf(reads, repo, [{ pull, closingKeys }])));
		}
	}
	return pulls;
}

function pullOfUrl({
	protocol,
	pathname,
	search,
	hash,
}: URL): Pick<PullLink, "repo" | "number"> | null {
	const match = pathname.match(/^\/([^/]+\/[^/]+)\/pulls\/(\d+)$/);
	const repo = match?.[1];
	const number = match?.[2];
	if (
		protocol !== "https:" ||
		search !== "" ||
		hash !== "" ||
		repo === undefined ||
		number === undefined
	) {
		return null;
	}
	return { repo, number: Number(number) };
}

/** Reads the PRs, branches, checks and reviews of the repos on one Forgejo host. */
export function forgejoForge(access: ForgejoAccess, fetchImpl: Fetch): Forge {
	const reads: Reads = {
		client: forgejoClient(access, fetchImpl),
		merged: new Map(),
	};
	const { client } = reads;
	return {
		async listPulls(repo) {
			const open = await client.rows(
				`${client.api}/repos/${repo}/pulls?state=open&limit=50`,
				"list pulls",
				forgejoPull,
			);
			return [
				...(await pullsOf(reads, repo, open.map(unlinked))),
				...(await mergedHistory(reads, repo)),
			];
		},
		async listLinkedPulls(links, repos) {
			const pulls = await linkedPulls(reads, links);
			const history = new Set([...pulls.map((pull) => pull.repo), ...repos]);
			for (const repo of history) {
				pulls.push(...(await mergedHistory(reads, repo)));
			}
			return pulls;
		},
		async listBranches(repo) {
			const branches = await client.rows(
				`${client.api}/repos/${repo}/branches?limit=50`,
				"list branches",
				z.object({ name: z.string() }),
			);
			return branches.map(({ name }) => name);
		},
		repoAutoMerge: async () => false,
		pullOfUrl,
	};
}
