/**
 * Serves a ticket with a draft PR, a local blocker, a cross-project blocker and a blocked ticket, for the side panel.
 * The local blocker has a done parent in the untracked project `acme/plan`.
 *
 * The second poll adds a needs-human label, which raises an inbox entry, and a second comment to the thread.
 * With `group-none`, the project graph groups by none, so its cards show the hierarchy chips.
 * Usage: `bun proof/serve-396.ts [PORT] [group-none]`.
 */
import type { Fetch } from "../src/fetch.ts";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const flow = "acme/flow";
const gate = "acme/gate";
let polls = 0;

function issue(
	repo: string,
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-10-18T10:00:00.000Z",
		created_at: "2026-10-01T10:00:00.000Z",
		body: "",
		labels: [],
		assignee: null,
		...fields,
	};
}

function panelTicket(): Record<string, unknown> {
	return issue(flow, 1, "Ship the side panel", {
		body: `Blocked by: #2\nBlocked by: ${gate}#9`,
		labels: polls > 1 ? [{ name: "needs-human" }] : [],
		assignee: polls > 1 ? { login: "lev" } : null,
	});
}

const planParent = {
	number: 5,
	title: "Plan the panel",
	state: "CLOSED",
	stateReason: "COMPLETED",
	url: "https://github.com/acme/plan/issues/5",
	repository: { nameWithOwner: "acme/plan" },
};

function issues(): Record<string, Record<string, unknown>[]> {
	return {
		[flow]: [
			panelTicket(),
			issue(flow, 2, "Draw the lane line", { parent: planParent }),
			issue(flow, 3, "Write the release note", { body: "Blocked by: #1" }),
		],
		[gate]: [issue(gate, 9, "Open the platform gate")],
	};
}

const draftPull = {
	number: 4,
	title: "Draft the side panel",
	html_url: `https://github.com/${flow}/pull/4`,
	draft: true,
	body: "Closes #1",
	head: { ref: "1-ship-the-side-panel", sha: "b".repeat(40) },
	state: "open",
	merged_at: null,
	auto_merge: null,
	user: { login: "ada" },
	created_at: "2026-10-17T10:00:00Z",
	updated_at: "2026-10-18T10:00:00Z",
};

function comment(id: number, body: string, at: string) {
	return {
		id,
		body,
		html_url: `https://github.com/${flow}/issues/1#issuecomment-${id}`,
		created_at: at,
		user: { login: "ada" },
	};
}

function thread(): Record<string, unknown>[] {
	const first = comment(101, "Thread before the poll", "2026-10-18T10:05:00Z");
	return polls > 1
		? [first, comment(102, "Thread after the poll", "2026-10-18T11:05:00Z")]
		: [first];
}

const noLinkedPulls = {
	data: {
		repository: {
			issue: { closedByPullRequestsReferences: { nodes: [] } },
		},
	},
};

const fetch: Fetch = async (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (body.includes("query RepoRead") && body.includes('"name":"flow"')) {
		polls += 1;
	}
	if (body.includes("query LinkedPulls")) {
		return Response.json(noLinkedPulls);
	}
	if (url === `https://api.github.com/repos/${flow}/issues/1`) {
		return Response.json(panelTicket());
	}
	if (
		url.startsWith(`https://api.github.com/repos/${flow}/issues/1/comments?`)
	) {
		return Response.json(thread());
	}
	return recordedIssues(issues(), { [flow]: [draftPull] })(input, init);
};

await serveRecorded({
	prefix: "project-flow-396-",
	port: process.argv[2]?.trim() || "47100",
	config: {
		pinned: [
			{ tracker: "github", repo: flow },
			{ tracker: "github", repo: gate },
		],
		checkoutRoots: [],
		viewerLogins: ["lev"],
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[flow]:
				process.argv[3] === "group-none"
					? { openView: "board", groupBy: "none" }
					: { openView: "board" },
		},
	},
	fetch,
	now: () => new Date("2026-10-18T12:00:00.000Z"),
});
