import type { AutoMerge } from "./configuration.ts";
import type { BotReview, Comment, PullRequest, PullStatus } from "./domain.ts";
import { type KnownBot, knownBots } from "./known-bots.ts";
import { repoKey, settingsKey } from "./project-ref.ts";
import { pullKey } from "./ticket-key.ts";
import { workcellRun } from "./workcell.ts";

const botLogin: Record<KnownBot, string> = {
	grok: "grok-code-review[bot]",
	codex: "chatgpt-codex-connector[bot]",
	greptile: "greptile-apps[bot]",
};

const botCheck: Record<KnownBot, RegExp> = {
	grok: /grok/i,
	codex: /codex/i,
	greptile: /greptile/i,
};

const usageLimit = /usage limit/i;

const codexMarker = "<!-- codex-pull-request-review-summary -->";

const greptileMarker = "<!-- greptile_summary -->";

const codexRow = /^\|[^|\n]*\*\*([^*|\n]+)[^|\n]*\|([^|\n]*)\|/gm;

function expectedBotsFromHistory(
	pulls: Pick<
		PullRequest,
		"merged" | "retained" | "checks" | "comments" | "reviews" | "reactions"
	>[],
): KnownBot[] {
	const found = new Set<KnownBot>();
	for (const pull of pulls) {
		if (!pull.merged || pull.retained === true) {
			continue;
		}
		for (const bot of knownBots) {
			if (pullShowsBot(pull, bot)) {
				found.add(bot);
			}
		}
	}
	return knownBots.filter((bot) => found.has(bot));
}

export function expectedBotsByRepo(
	pulls: Pick<
		PullRequest,
		| "repo"
		| "merged"
		| "retained"
		| "checks"
		| "comments"
		| "reviews"
		| "reactions"
	>[],
	overrides: Record<string, KnownBot[]>,
): Map<string, KnownBot[]> {
	const repos = new Set(pulls.map((pull) => pull.repo));
	const bots = new Map<string, KnownBot[]>();
	for (const repo of repos) {
		const saved = repoKey(overrides, repo);
		bots.set(
			repo,
			saved === undefined
				? expectedBotsFromHistory(pulls.filter((pull) => pull.repo === repo))
				: (overrides[saved] ?? []),
		);
	}
	return bots;
}

function pullShowsBot(
	pull: Pick<PullRequest, "checks" | "comments" | "reviews" | "reactions">,
	bot: KnownBot,
): boolean {
	const login = botLogin[bot];
	if (pull.checks.some((check) => botCheck[bot].test(check.name))) {
		return true;
	}
	if (pull.comments.some((comment) => comment.login === login)) {
		return true;
	}
	if (pull.reviews.some((review) => review.login === login)) {
		return true;
	}
	return pull.reactions.some((reaction) => reaction.login === login);
}

type BotPass = { done: boolean; warning: string | null };

function botPass(pull: PullRequest, bot: KnownBot): BotPass {
	if (bot === "codex" && eyesStillRunning(pull)) {
		return { done: false, warning: null };
	}
	const warning = botWarning(pull, bot);
	if (warning !== null) {
		return { done: true, warning };
	}
	if (bot === "grok") {
		const check = pull.checks.find((item) => botCheck.grok.test(item.name));
		const review = pull.reviews.find(
			(item) => item.login === botLogin.grok && item.commitId === pull.headSha,
		);
		const done = check?.status === "completed" && review !== undefined;
		return { done, warning: null };
	}
	if (bot === "codex") {
		const summary = pull.comments.find(
			(comment) =>
				comment.login === botLogin.codex && comment.body.includes(codexMarker),
		);
		const rows = [...(summary?.body.matchAll(codexRow) ?? [])];
		const completed =
			summary !== undefined &&
			rows.length > 0 &&
			rows.some((row) => (row[2] ?? "").includes("Completed"));
		const reactionOnly =
			summary === undefined &&
			pull.reactions.some(
				(reaction) =>
					reaction.login === botLogin.codex && reaction.content !== "eyes",
			);
		return { done: completed || reactionOnly, warning: null };
	}
	const summary = pull.comments.find(
		(comment) =>
			comment.login === botLogin.greptile &&
			comment.body.includes(greptileMarker),
	);
	const running = pull.checks.some(
		(check) =>
			botCheck.greptile.test(check.name) && check.status !== "completed",
	);
	return { done: summary !== undefined && !running, warning: null };
}

function botWarning(pull: PullRequest, bot: KnownBot): string | null {
	const check = pull.checks.find((item) => botCheck[bot].test(item.name));
	if (check?.status === "completed") {
		if (
			check.conclusion === "failure" ||
			check.conclusion === "cancelled" ||
			check.conclusion === "skipped" ||
			check.conclusion === "timed_out"
		) {
			return `${bot} ${check.conclusion}`;
		}
	}
	const login = botLogin[bot];
	const limited = pull.comments.some(
		(comment) =>
			comment.login === login &&
			usageLimit.test(comment.body) &&
			countsForHead(pull, bot, comment.createdAt),
	);
	return limited ? `${bot} usage limit` : null;
}

function eyesStillRunning(pull: PullRequest): boolean {
	const eyes = pull.reactions.filter(
		(reaction) =>
			reaction.login === botLogin.codex && reaction.content === "eyes",
	);
	if (eyes.length === 0) {
		return false;
	}
	if (eyes.some((reaction) => reaction.createdAt === null)) {
		return true;
	}
	const eyesAt = newestAt(eyes.map((reaction) => reaction.createdAt));
	const limitAt = newestAt(
		pull.comments
			.filter(
				(comment) =>
					comment.login === botLogin.codex && usageLimit.test(comment.body),
			)
			.map((comment) => comment.createdAt),
	);
	if (eyesAt === null || limitAt === null) {
		return true;
	}
	return Date.parse(eyesAt) >= Date.parse(limitAt);
}

function newestAt(times: (string | null)[]): string | null {
	let newest: string | null = null;
	for (const time of times) {
		if (time === null) {
			continue;
		}
		if (newest === null || Date.parse(time) > Date.parse(newest)) {
			newest = time;
		}
	}
	return newest;
}

function countsForHead(
	pull: PullRequest,
	bot: KnownBot,
	createdAt: string | null,
): boolean {
	if (bot !== "grok") {
		return true;
	}
	if (pull.headCommittedAt === null || createdAt === null) {
		return false;
	}
	return Date.parse(createdAt) > Date.parse(pull.headCommittedAt);
}

export function reviewState(
	pulls: PullRequest[],
	expectedByRepo: Map<string, KnownBot[]>,
	comments: Comment[] = [],
): { state: "inReview" | "awaitingMerge" | null; tags: string[] } {
	const open = pulls.filter((pull) => !pull.merged);
	if (open.length === 0 || open.some((pull) => pull.draft)) {
		return { state: null, tags: [] };
	}
	const tags: string[] = [];
	let waiting = false;
	for (const pull of open) {
		const run = workcellRun(comments, pull);
		const cycle = run ?? botCycle(pull, expectedByRepo);
		for (const tag of cycle.tags) {
			tags.push(tag);
		}
		if (cycle.state === "inReview") {
			waiting = true;
		}
	}
	return { state: waiting ? "inReview" : "awaitingMerge", tags };
}

function botCycle(
	pull: PullRequest,
	expectedByRepo: Map<string, KnownBot[]>,
): { state: "inReview" | "awaitingMerge"; tags: string[] } {
	const tags: string[] = [];
	let waiting = false;
	for (const bot of expectedByRepo.get(pull.repo) ?? []) {
		const pass = botPass(pull, bot);
		if (pass.warning !== null) {
			tags.push(pass.warning);
		}
		if (!pass.done) {
			waiting = true;
		}
	}
	return { state: waiting ? "inReview" : "awaitingMerge", tags };
}

export type AutoMergeSources = {
	config: Record<string, AutoMerge>;
	workcell: Record<string, AutoMerge>;
	repo: Record<string, boolean>;
};

/** True when every open PR merges with no human. Workcell `merge_auto` applies only to `workcellPulls`. */
export function mergesOnItsOwn(
	links: PullRequest[],
	project: string,
	projectKey: string,
	auto: AutoMergeSources,
	workcellPulls: ReadonlySet<string>,
): boolean {
	const open = links.filter((pull) => !pull.merged);
	if (open.length === 0) {
		return false;
	}
	return open.every((pull) => {
		const configured =
			auto.config[pull.repo] ?? auto.config[projectKey] ?? auto.config[project];
		if (configured !== undefined) {
			return configured === "yes";
		}
		const workcell = workcellPulls.has(pullKey(pull))
			? auto.workcell[pull.repo]
			: undefined;
		if (workcell !== undefined) {
			return workcell === "yes";
		}
		return (
			pull.autoMerge === true ||
			auto.repo[settingsKey(pull.repo, pull.host)] === true
		);
	});
}

function ciOf(pull: PullRequest): PullStatus["ci"] {
	if (pull.checks.length === 0) {
		return "none";
	}
	if (
		pull.checks.some(
			(check) =>
				check.conclusion === "failure" ||
				check.conclusion === "cancelled" ||
				check.conclusion === "timed_out",
		)
	) {
		return "failing";
	}
	if (
		pull.checks.some(
			(check) => check.status !== "completed" || check.conclusion === null,
		)
	) {
		return "pending";
	}
	if (
		pull.checks.every(
			(check) =>
				check.conclusion === "success" ||
				check.conclusion === "skipped" ||
				check.conclusion === "neutral",
		)
	) {
		return "passing";
	}
	return "pending";
}

function reviewOf(pull: PullRequest): PullStatus["review"] {
	const latest = new Map<string, BotReview>();
	for (const review of pull.reviews) {
		if (review.commitId !== pull.headSha || review.state === "COMMENTED") {
			continue;
		}
		latest.set(review.login, review);
	}
	const decided = [...latest.values()];
	if (decided.some((review) => review.state === "CHANGES_REQUESTED")) {
		return "changes";
	}
	if (decided.some((review) => review.state === "APPROVED")) {
		return "approved";
	}
	const onHead = pull.reviews.filter(
		(review) => review.commitId === pull.headSha,
	);
	const completed = knownBots.some((bot) => {
		if (!botPass(pull, bot).done) {
			return false;
		}
		return onHead.some(
			(review) =>
				review.login === botLogin[bot] &&
				review.state !== "APPROVED" &&
				review.state !== "CHANGES_REQUESTED",
		);
	});
	if (completed) {
		return "completed";
	}
	if (onHead.length > 0) {
		return "pending";
	}
	return "none";
}

export function pullStatus(pull: PullRequest): PullStatus {
	return {
		number: pull.number,
		title: pull.title,
		url: pull.url,
		ci: ciOf(pull),
		review: reviewOf(pull),
	};
}
