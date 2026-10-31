import { z } from "zod";

import type { BotCheck, BotReview, PullRequest } from "./domain.ts";
import { defaultTrackerRequestLimitMs, type Fetch } from "./fetch.ts";
import { nextPage } from "./github-pages.ts";
import { TrackerError } from "./ports.ts";

export const forgejoPull = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	draft: z.boolean().optional(),
	body: z.string().nullable(),
	state: z.string(),
	merged: z.boolean(),
	head: z.object({ ref: z.string(), sha: z.string() }),
});

export type ForgejoPull = z.infer<typeof forgejoPull>;

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

export type ReviewEvidence = Pick<
	PullRequest,
	"checks" | "comments" | "reviews" | "reactions"
>;

/** The requests of one token on one Forgejo host. */
export type ForgejoClient = {
	/** The base URL of the host's API, such as `https://codeberg.org/api/v1`. */
	api: string;
	get: (url: string, label: string) => Promise<Response>;
	/** Each row of each page from `start` on, as the `link` header pages them. */
	rows: <Row>(
		start: string,
		label: string,
		row: z.ZodType<Row>,
	) => Promise<Row[]>;
};

function forgejoInit(token: string): RequestInit {
	return {
		headers: { accept: "application/json", authorization: `token ${token}` },
		signal: AbortSignal.timeout(defaultTrackerRequestLimitMs),
	};
}

export function forgejoClient(
	host: string,
	token: string,
	fetchImpl: Fetch,
): ForgejoClient {
	const get = async (url: string, label: string): Promise<Response> => {
		const response = await fetchImpl(url, forgejoInit(token));
		if (!response.ok) {
			throw new TrackerError(
				`Forgejo ${label} failed (HTTP ${response.status}): ${url}`,
				response.status,
			);
		}
		return response;
	};
	return {
		api: `https://${host}/api/v1`,
		get,
		async rows(start, label, row) {
			const found = [];
			let url: string | null = start;
			while (url !== null) {
				const response = await get(url, label);
				found.push(...z.array(row).parse(await response.json()));
				url = nextPage(response.headers.get("link"));
			}
			return found;
		},
	};
}

/** Checks a token against the user read of its Forgejo host. */
export function checkForgejoToken(
	host: string,
	token: string,
	fetchImpl: Fetch,
): Promise<Response> {
	return fetchImpl(`https://${host}/api/v1/user`, forgejoInit(token));
}

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

/** The checks, reviews and comments of a PR at its head. Forgejo gives no reactions. */
export async function readEvidence(
	client: ForgejoClient,
	repo: string,
	pull: ForgejoPull,
): Promise<ReviewEvidence> {
	const base = `${client.api}/repos/${repo}`;
	const [status, reviews, comments] = await Promise.all([
		client
			.get(`${base}/commits/${pull.head.sha}/status`, "read status")
			.then(async (response) => combinedStatus.parse(await response.json())),
		client.rows(
			`${base}/pulls/${pull.number}/reviews?limit=50`,
			"list reviews",
			forgejoReview,
		),
		client.rows(
			`${base}/issues/${pull.number}/comments?limit=50`,
			"list comments",
			forgejoComment,
		),
	]);
	return {
		checks: (status.statuses ?? []).map(({ context, status }) =>
			checkOf(context, status),
		),
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
}
