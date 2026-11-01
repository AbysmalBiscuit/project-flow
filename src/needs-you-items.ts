import type {
	AwaitingPull,
	Comment,
	FactoryRun,
	NeedsYouItem,
	NeedsYouRules,
	ProjectCounts,
	PullRequest,
	Ticket,
} from "./domain.ts";
import { openImportantQuestions } from "./important-questions.ts";
import type { KnownBot } from "./known-bots.ts";
import { awaitingPull, type PullActionsOf } from "./merge-gate.ts";
import { type OpenAsk, openAsk, routedQuestion } from "./open-ask.ts";
import { settingsKey } from "./project-ref.ts";
import {
	type AutoMergeSources,
	mergesOnItsOwn,
	pullStatus,
	reviewState,
} from "./review.ts";
import { foldKey, pullId, pullKey } from "./ticket-key.ts";

function assignedToViewer(ticket: Ticket, viewers: Set<string>): boolean {
	const names = [
		...(ticket.assignees ?? []),
		...(ticket.assignee === undefined || ticket.assignee === null
			? []
			: [ticket.assignee]),
	];
	return names.some((name) => {
		const trimmed = name.trim().toLowerCase();
		return trimmed !== "" && viewers.has(trimmed);
	});
}

function needsYouItem(
	project: string,
	tracker: ProjectCounts["tracker"],
	key: string,
	title: string,
	ask: OpenAsk | null,
	reason: NeedsYouItem["reason"],
	pulls: PullRequest[] = [],
	factoryAsk?: NeedsYouItem["factoryAsk"],
): NeedsYouItem {
	const reply = ask?.answer?.comment ?? null;
	const pull = pulls.find((item) => !item.merged) ?? pulls[0];
	const openQuestions =
		reason === "awaitingMerge"
			? pulls
					.filter((item) => !item.merged)
					.flatMap((item) => openImportantQuestions(item.body)).length
			: 0;
	return {
		project,
		tracker,
		key,
		headline: ask?.headline ?? title,
		reason: openQuestions > 0 ? "decide" : reason,
		...(openQuestions > 0 ? { openQuestions } : {}),
		tags: ask?.tags ?? [],
		answered: reply !== null,
		acknowledged: (reply?.reactions ?? 0) > 0,
		...(ask === null ? {} : { question: ask.question, options: ask.options }),
		...(pull === undefined ? {} : { pull: pullStatus(pull) }),
		...(factoryAsk === undefined ? {} : { factoryAsk }),
	};
}

/** The item of a PR with no ticket. The item carries the declared host of the PR. */
function pullItem(
	project: string,
	pull: PullRequest,
	ask: OpenAsk | null,
	reason: NeedsYouItem["reason"],
): NeedsYouItem {
	const item = needsYouItem(
		project,
		"github",
		pullKey(pull),
		pull.title,
		ask,
		reason,
		[pull],
	);
	return pull.host === undefined ? item : { ...item, host: pull.host };
}

/**
 * The ask of a blocked run. A run whose questions are unknown asks with the ticket title.
 * A run whose open questions all go to the PM Bot gives no ask.
 */
function runAsk(
	run: FactoryRun | undefined,
	pmBot: boolean,
): { ask: OpenAsk | null; factoryAsk?: NeedsYouItem["factoryAsk"] } | null {
	if (run === undefined) {
		return null;
	}
	if (run.questions === undefined) {
		return { ask: null };
	}
	const question = routedQuestion(run.questions, pmBot);
	if (question === undefined) {
		return null;
	}
	return {
		ask: {
			id: question.id,
			comment: { body: question.text },
			headline: question.text,
			question: question.text,
			options: [],
			open: true,
			answer: null,
			tags: [],
		},
		factoryAsk: { factory: run.factory, run: run.id, question: question.id },
	};
}

/**
 * The item with its awaiting PRs. A Decide row offers no merge, because the
 * merge gate blocks a PR with an open Important Question.
 */
function withAwaitingPulls(
	item: NeedsYouItem,
	awaitingPulls: AwaitingPull[],
): NeedsYouItem {
	return {
		...item,
		awaitingPulls:
			item.reason === "decide"
				? awaitingPulls.map((pull) => ({
						...pull,
						actions: pull.actions.filter((action) => action !== "merge"),
					}))
				: awaitingPulls,
	};
}

export function pullComments(pull: PullRequest): Comment[] {
	return pull.comments.map((comment) => ({
		body: comment.body,
		...(comment.createdAt === null ? {} : { createdAt: comment.createdAt }),
		author: comment.login,
		...(comment.reactions === undefined
			? {}
			: { reactions: comment.reactions }),
	}));
}

export function needsYouItems(
	project: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
	pulls: PullRequest[],
	unlinkedPulls: PullRequest[],
	linkedByTicket: Map<string, PullRequest[]>,
	expectedBots: Map<string, KnownBot[]>,
	awaitingByKey: Map<string, AwaitingPull[]>,
	pullActionsOf: PullActionsOf,
	failedKeys: Set<string>,
	blockedRuns: Map<string, FactoryRun>,
	rules: NeedsYouRules,
	autoMerge: AutoMergeSources,
	workcellPulls: ReadonlySet<string>,
	projectKey: string,
): NeedsYouItem[] {
	const labels = new Set(rules.labels.map((label) => label.toLowerCase()));
	const viewers = new Set(
		rules.viewerLogins.map((login) => login.toLowerCase()),
	);
	const items: NeedsYouItem[] = [];
	for (const ticket of tickets) {
		if (ticket.state !== "open" || ticket.key === null) {
			continue;
		}
		const awaitingPulls = awaitingByKey.get(foldKey(ticket.key)) ?? [];
		const linkedPulls = linkedByTicket.get(ticket.key) ?? [];
		const comments = [
			...(ticket.comments ?? []),
			...linkedPulls.flatMap(pullComments),
		];
		const commentAsk = openAsk(comments, rules.pmBot);
		const fromRun =
			commentAsk === null
				? runAsk(blockedRuns.get(ticket.key), rules.pmBot)
				: null;
		const ask = commentAsk ?? fromRun?.ask ?? null;
		const labelled =
			assignedToViewer(ticket, viewers) &&
			ticket.labels.some((label) => labels.has(label.toLowerCase()));
		const awaiting = awaitingPulls.length > 0;
		const failed = failedKeys.has(ticket.key);
		const asked = ask !== null || fromRun !== null;
		if (!asked && !labelled && !awaiting && !failed) {
			continue;
		}
		const item = needsYouItem(
			project,
			tracker,
			ticket.key,
			ticket.title,
			ask,
			asked
				? "ask"
				: awaiting
					? "awaitingMerge"
					: failed
						? "runFailed"
						: "label",
			linkedPulls,
			fromRun?.factoryAsk,
		);
		items.push(awaiting ? withAwaitingPulls(item, awaitingPulls) : item);
	}
	const folded = new Set(
		[...linkedByTicket.values()].flat().map((pull) => pullId(pull)),
	);
	const listed = new Set(
		items.map((item) => foldKey(settingsKey(item.key, autoMerge.projectHost))),
	);
	for (const pull of pulls) {
		if (folded.has(pullId(pull))) {
			continue;
		}
		const comments = pullComments(pull);
		const ask = openAsk(comments, rules.pmBot);
		if (ask === null) {
			continue;
		}
		listed.add(pullId(pull));
		items.push(pullItem(project, pull, ask, "ask"));
	}
	for (const pull of unlinkedPulls) {
		if (listed.has(pullId(pull))) {
			continue;
		}
		if (reviewState([pull], expectedBots, []).state !== "awaitingMerge") {
			continue;
		}
		if (mergesOnItsOwn([pull], project, projectKey, autoMerge, workcellPulls)) {
			continue;
		}
		items.push(
			withAwaitingPulls(pullItem(project, pull, null, "awaitingMerge"), [
				awaitingPull(pull, pullActionsOf),
			]),
		);
	}
	items.sort((left, right) => Number(left.answered) - Number(right.answered));
	return items;
}
