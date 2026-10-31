import type { TrackerKind } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { goodPoll } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	issuesResponse,
	type ListedRead,
	listedRead,
	page,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	unrecorded,
} from "../support/github.ts";
import type { OverviewBody } from "../support/reads.ts";

const seenPolls = new WeakMap<string[], Set<string>>();

export function pushListed(requests: string[], read: ListedRead): void {
	const seen = seenPolls.get(requests) ?? new Set<string>();
	seenPolls.set(requests, seen);
	if (seen.has(read.poll)) {
		return;
	}
	seen.add(read.poll);
	requests.push(read.url);
}

export function unchangedFetch(
	requests: string[],
	issues: Record<string, unknown>[] = [],
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const steady = listedRead(input, init);
		if (steady !== null && steady.repo === repo) {
			pushListed(requests, steady);
			return issuesResponse(input, init, issues) ?? page([]);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
}

export function counts(
	name: string,
	backlog: number,
	done = 0,
	tracker: TrackerKind = "github",
	tickets: OverviewBody["projects"][number]["tickets"] = [],
	fetchedAt: string | null = goodPoll,
	error: string | null = null,
): OverviewBody["projects"][number] {
	return {
		name,
		tracker,
		done,
		dropped: 0,
		blocked: 0,
		backlog,
		inProgress: 0,
		inReview: 0,
		awaitingMerge: 0,
		tags: [],
		unlinkedPrs: [],
		tickets,
		crossProjectBlockers: [],
		needsYou: 0,
		progress:
			backlog + done === 0 ? 0 : Math.round((done / (backlog + done)) * 100),
		fetchedAt,
		error,
		statusTypes: {
			backlog,
			inProgress: 0,
			inReview: 0,
			awaitingMerge: 0,
			done,
			dropped: 0,
		},
		ref:
			tracker === "linear"
				? { tracker: "linear", project: name }
				: { tracker: "github", repo: name },
		displayKey: name,
	};
}

export function githubTicket(
	number: number,
	state: "backlog" | "done",
	enteredStateAt = "2026-04-01T00:00:00Z",
	updatedAt = "2026-04-01T00:00:00Z",
): OverviewBody["projects"][number]["tickets"][number] {
	return {
		key: `${repo}#${number}`,
		title: `Ticket ${number}`,
		state,
		blockers: [],
		lane: state === "done" ? "Done" : "Backlog",
		statusType: state,
		enteredStateAt,
		updatedAt,
	};
}
