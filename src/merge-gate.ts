import type {
	AwaitingPull,
	MergeGate,
	PullAction,
	PullRequest,
} from "./domain.ts";
import { openImportantQuestions } from "./important-questions.ts";
import type { Forge } from "./ports.ts";
import { mergeGateReason } from "./pull-terms.ts";
import { ciOf } from "./review.ts";

/** The actions that the forge of the PR at `url` can take. */
export type PullActionsOf = (url: string) => PullAction[];

/** The actions that the capabilities of a forge allow on its PRs. */
export function pullActions(forge: Forge | null): PullAction[] {
	return [
		...(forge?.merge === undefined ? [] : ["merge" as const]),
		...(forge?.requestChanges === undefined ? [] : ["requestChanges" as const]),
	];
}

/** Whether Project Flow lets Lev merge an awaiting PR, and the reason when it does not. */
function mergeGate(pull: PullRequest): MergeGate {
	const ci = ciOf(pull);
	if (ci === "failing") {
		return { open: false, reason: mergeGateReason.failedCheck };
	}
	if (openImportantQuestions(pull.body).length > 0) {
		return { open: false, reason: mergeGateReason.openQuestion };
	}
	if (ci === "pending") {
		return { open: false, reason: mergeGateReason.pendingCheck };
	}
	return { open: true };
}

/** The API form of a PR in Awaiting merge. */
export function awaitingPull(
	pull: PullRequest,
	actionsOf: PullActionsOf,
): AwaitingPull {
	return {
		repo: pull.repo,
		number: pull.number,
		title: pull.title,
		url: pull.url,
		...(pull.baseBranch === undefined ? {} : { baseBranch: pull.baseBranch }),
		headSha: pull.headSha,
		actions: actionsOf(pull.url),
		mergeGate: mergeGate(pull),
	};
}
