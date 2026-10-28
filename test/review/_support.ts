import { repo } from "../support/github.ts";

export const older = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const codex = "chatgpt-codex-connector[bot]";
export const grok = "grok-code-review[bot]";
export const greptile = "greptile-apps[bot]";

export function card(
	state: "backlog" | "inProgress" | "inReview" | "awaitingMerge",
	counts: {
		backlog: number;
		inProgress: number;
		inReview: number;
		awaitingMerge: number;
	},
	tags: string[] = [],
	needsYou = counts.awaitingMerge,
	key = `${repo}#8`,
	title = "Ticket 8",
): {
	projects: {
		name: string;
		tracker: "github";
		ref: { tracker: "github"; repo: string };
		done: number;
		dropped: number;
		blocked: number;
		backlog: number;
		inProgress: number;
		inReview: number;
		awaitingMerge: number;
		needsYou: number;
		progress: number;
		fetchedAt: string;
		error: null;
		tags: string[];
		unlinkedPrs: [];
		tickets: {
			key: string;
			title: string;
			state: string;
			blockers: [];
			lane: string;
			statusType: string;
			enteredStateAt: string;
			updatedAt: string;
		}[];
		crossProjectBlockers: [];
		statusTypes: Record<string, number>;
	}[];
	fetchedAt: string;
	error: null;
} {
	return {
		projects: [
			{
				name: repo,
				tracker: "github",
				ref: { tracker: "github", repo },
				done: 0,
				dropped: 0,
				blocked: 0,
				...counts,
				needsYou,
				progress: 0,
				fetchedAt: "2026-10-18T12:00:00.000Z",
				error: null,
				tags,
				unlinkedPrs: [],
				tickets: [
					{
						key,
						title,
						state,
						blockers: [],
						lane: laneName(state),
						statusType: state,
						enteredStateAt: "2026-10-01T00:00:00Z",
						updatedAt: "2026-10-01T00:00:00Z",
					},
				],
				crossProjectBlockers: [],
				statusTypes: {
					backlog: state === "backlog" ? 1 : 0,
					inProgress: state === "inProgress" ? 1 : 0,
					inReview: state === "inReview" ? 1 : 0,
					awaitingMerge: state === "awaitingMerge" ? 1 : 0,
					done: 0,
					dropped: 0,
				},
			},
		],
		fetchedAt: "2026-10-18T12:00:00.000Z",
		error: null,
	};
}

function laneName(state: string): string {
	if (state === "inProgress") {
		return "In progress";
	}
	if (state === "inReview") {
		return "In review";
	}
	if (state === "awaitingMerge") {
		return "Awaiting merge";
	}
	return "Backlog";
}

export function issue(number: number): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-10-01T00:00:00Z",
	};
}

export function progress(lines: string): string {
	return `**Workcell progress**\n\n${lines}`;
}

export function mergedPull(): Record<string, unknown> {
	return {
		number: 1,
		title: "merged",
		state: "closed",
		draft: false,
		html_url: `https://github.com/${repo}/pull/1`,
		head: { ref: "1-merged", sha: older },
		body: "",
		merged_at: "2026-10-01T00:00:00Z",
	};
}
