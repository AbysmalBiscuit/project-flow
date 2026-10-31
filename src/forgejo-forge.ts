import { z } from "zod";

import type { BotCheck, BotReview, PullRequest } from "./domain.ts";
import { defaultTrackerRequestLimitMs, type Fetch } from "./fetch.ts";
import { nextPage } from "./github-pages.ts";
import { type Forge, type PullLink, TrackerError } from "./ports.ts";
import { numberedKey } from "./ticket-key.ts";

const forgejoPull = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	draft: z.boolean().optional(),
	body: z.string().nullable(),
	state: z.string(),
	merged: z.boolean(),
	head: z.object({ ref: z.string(), sha: z.string() }),
});

type ForgejoPull = z.infer<typeof forgejoPull>;

const login = z.object({ login: z.string() }).nullable();

const combinedStatus = z.object({
	statuses: z
		.array(z.object({ context: z.string(), status: z.string() }))
		.nullable(),
});

const forgejoReview = z.object({
	user: login,
	state: z.string(),
	commit_id: z.string(),
	dismissed: z.boolean().optional(),
});

const forgejoComment = z.object({
	user: login,
	body: z.string(),
	created_at: z.string().optional(),
});

const forgejoBranch = z.object({ name: z.string() });

type ReviewEvidence = Pick<
	PullRequest,
	"checks" | "comments" | "reviews" | "reactions"
>;

const noEvidence: ReviewEvidence = {
	checks: [],
	comments: [],
	reviews: [],
	reactions: [],
};

/** A Forgejo commit status as a check: `pending`, `success`, `error`, `failure` or `warning`. */
function checkOf(context: string, status: string): BotCheck {
	switch (status) {
		case "success":
			return { name: context, status: "completed", conclusion: "success" };
		case "failure":
		case "error":
			return { name: context, status: "completed", conclusion: "failure" };
		case "warning":
			return { name: context, status: "completed", conclusion: "neutral" };
		default:
			return { name: context, status: "in_progress", conclusion: null };
	}
}

const reviewStates: Record<string, BotReview["state"]> = {
	APPROVED: "APPROVED",
	REQUEST_CHANGES: "CHANGES_REQUESTED",
	COMMENT: "COMMENTED",
	PENDING: "PENDING",
};

/** Reads the PRs, branches, checks and reviews of the repos on one Forgejo host. */
export function forgejoForge(
	host: string,
	token: string,
	fetchImpl: Fetch,
): Forge {
	const api = `https://${host}/api/v1`;
	const merged = new Map<string, ReviewEvidence>();

	const get = async (url: string, label: string): Promise<Response> => {
		const response = await fetchImpl(url, {
			headers: { accept: "application/json", authorization: `token ${token}` },
			signal: AbortSignal.timeout(defaultTrackerRequestLimitMs),
		});
		if (!response.ok) {
			throw new TrackerError(
				`Forgejo ${label} failed (HTTP ${response.status}): ${url}`,
				response.status,
			);
		}
		return response;
	};

	const rows = async <Row>(
		start: string,
		label: string,
		row: z.ZodType<Row>,
	): Promise<Row[]> => {
		const found: Row[] = [];
		let url: string | null = start;
		while (url !== null) {
			const response = await get(url, label);
			found.push(...z.array(row).parse(await response.json()));
			url = nextPage(response.headers.get("link"));
		}
		return found;
	};

	const evidence = async (
		repo: string,
		pull: ForgejoPull,
	): Promise<ReviewEvidence> => {
		const [status, reviews, comments] = await Promise.all([
			get(`${api}/repos/${repo}/commits/${pull.head.sha}/status`, "read status")
				.then(async (response) => combinedStatus.parse(await response.json()))
				.then(({ statuses }) => statuses ?? []),
			rows(
				`${api}/repos/${repo}/pulls/${pull.number}/reviews?limit=50`,
				"list reviews",
				forgejoReview,
			),
			rows(
				`${api}/repos/${repo}/issues/${pull.number}/comments?limit=50`,
				"list comments",
				forgejoComment,
			),
		]);
		return {
			checks: status.map(({ context, status }) => checkOf(context, status)),
			reviews: reviews.flatMap(({ user, state, commit_id, dismissed }) => {
				const mapped = dismissed === true ? "DISMISSED" : reviewStates[state];
				return user === null || mapped === undefined
					? []
					: [{ login: user.login, commitId: commit_id, state: mapped }];
			}),
			comments: comments.flatMap(({ user, body, created_at }) =>
				user === null
					? []
					: [{ login: user.login, body, createdAt: created_at ?? null }],
			),
			reactions: [],
		};
	};

	const pullOf = async (
		repo: string,
		pull: ForgejoPull,
		closingKeys: string[],
	): Promise<PullRequest> => {
		const draft = pull.draft === true;
		const key = numberedKey(repo, pull.number);
		const read =
			merged.get(key) ?? (draft ? noEvidence : await evidence(repo, pull));
		if (pull.merged) {
			merged.set(key, read);
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
			headCommittedAt: null,
			merged: pull.merged,
			...read,
		};
	};

	/** Each PR in order. A PR that fails to read is left out until the next poll. */
	const pullsOf = async (
		repo: string,
		listed: { pull: ForgejoPull; closingKeys: string[] }[],
	): Promise<PullRequest[]> => {
		const pulls: PullRequest[] = [];
		for (const { pull, closingKeys } of listed) {
			const read = await pullOf(repo, pull, closingKeys).catch(() => null);
			if (read !== null) {
				pulls.push(read);
			}
		}
		return pulls;
	};

	const mergedHistory = async (repo: string): Promise<PullRequest[]> => {
		const response = await get(
			`${api}/repos/${repo}/pulls?state=closed&limit=10`,
			"list pulls",
		).catch(() => null);
		if (response === null) {
			return [];
		}
		const closed = z.array(forgejoPull).parse(await response.json());
		return pullsOf(
			repo,
			closed
				.filter((pull) => pull.merged)
				.map((pull) => ({ pull, closingKeys: [] })),
		);
	};

	const linkedPulls = async (links: PullLink[]): Promise<PullRequest[]> => {
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
			const read = await get(
				`${api}/repos/${repo}/pulls/${number}`,
				"read pull",
			)
				.then(async (response) => forgejoPull.parse(await response.json()))
				.catch(() => null);
			if (read !== null && (read.state === "open" || read.merged)) {
				pulls.push(...(await pullsOf(repo, [{ pull: read, closingKeys }])));
			}
		}
		return pulls;
	};

	return {
		async listPulls(repo) {
			const open = await rows(
				`${api}/repos/${repo}/pulls?state=open&limit=50`,
				"list pulls",
				forgejoPull,
			);
			return [
				...(await pullsOf(
					repo,
					open.map((pull) => ({ pull, closingKeys: [] })),
				)),
				...(await mergedHistory(repo)),
			];
		},
		async listLinkedPulls(links, repos) {
			const pulls = await linkedPulls(links);
			const history = new Set([...pulls.map((pull) => pull.repo), ...repos]);
			for (const repo of history) {
				pulls.push(...(await mergedHistory(repo)));
			}
			return pulls;
		},
		async listBranches(repo) {
			const branches = await rows(
				`${api}/repos/${repo}/branches?limit=50`,
				"list branches",
				forgejoBranch,
			);
			return branches.map(({ name }) => name);
		},
		repoAutoMerge: async () => false,
		pullOfUrl({ protocol, pathname, search, hash }) {
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
		},
	};
}

/** Checks a token against the user read of its Forgejo host. */
export async function checkForgejoToken(
	host: string,
	token: string,
	fetchImpl: Fetch,
): Promise<Response> {
	return fetchImpl(`https://${host}/api/v1/user`, {
		headers: { accept: "application/json", authorization: `token ${token}` },
		signal: AbortSignal.timeout(defaultTrackerRequestLimitMs),
	});
}
