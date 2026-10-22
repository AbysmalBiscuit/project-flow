import { createServer } from "node:net";
import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const repo = "acme/widget";
const end = { hasNextPage: false, endCursor: null };
const ask = "<!-- workcell:ask card-lanes -->\nWhich colour stays?";

const labels = [
	{ name: "ready", color: "d0d7de" },
	{ name: "factory: running", color: "f0c674" },
	{ name: "factory: in-review", color: "9ecbff" },
];

function recordedIssue(
	number: number,
	title: string,
	issueLabels: string[],
	state: "OPEN" | "CLOSED" = "OPEN",
	fields: Record<string, unknown> = {},
) {
	return {
		number,
		title,
		state,
		stateReason: state === "CLOSED" ? "COMPLETED" : null,
		updatedAt: "2026-10-18T12:00:00Z",
		createdAt: "2026-10-01T00:00:00Z",
		closedAt: state === "CLOSED" ? "2026-10-18T12:00:00Z" : null,
		body: "",
		comments: { nodes: [], pageInfo: end },
		labels: {
			nodes: issueLabels.map((name) => ({ name, color: "d0d7de" })),
			pageInfo: end,
		},
		assignees: { nodes: [] },
		milestone: null,
		parent: null,
		blockedBy: { nodes: [], pageInfo: end },
		blocking: { nodes: [], pageInfo: end },
		...fields,
	};
}

const blocker = recordedIssue(2, "Open the gate", ["ready"]);
const blocked = recordedIssue(3, "Hold the launch window", ["ready"], "OPEN", {
	blockedBy: {
		nodes: [
			{
				number: 2,
				title: "Open the gate",
				state: "OPEN",
				repository: { nameWithOwner: repo },
			},
		],
		pageInfo: end,
	},
});
const needs = recordedIssue(4, "Pick the card colour", ["ready"], "OPEN", {
	comments: {
		nodes: [
			{
				databaseId: 4,
				body: ask,
				createdAt: "2026-10-18T11:00:00Z",
				author: { login: "factory" },
			},
		],
		pageInfo: end,
	},
});
const issues = [
	recordedIssue(1, "Queue the board card", ["ready"]),
	blocker,
	blocked,
	needs,
	recordedIssue(5, "Build the lane tint", ["factory: running"]),
	recordedIssue(6, "Read the review comments", ["factory: in-review"]),
	...Array.from({ length: 6 }, (_, index) =>
		recordedIssue(10 + index, `Close item ${String(index + 1)}`, [], "CLOSED"),
	),
];

function recordedRepo(): Response {
	return Response.json({
		data: {
			repository: {
				nameWithOwner: repo,
				autoMergeAllowed: false,
				refs: { nodes: [], pageInfo: end },
				labels: { nodes: labels, pageInfo: end },
				issues: { nodes: issues, pageInfo: end },
				openPullRequests: { nodes: [], pageInfo: end },
				mergedPullRequests: { nodes: [], pageInfo: end },
			},
		},
	});
}

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	const linear = emptyLinear(url);
	if (linear !== null) {
		return linear;
	}
	if (emptyLists(url) || url.includes("/dependencies/")) {
		return Response.json([]);
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("RepoRead")) {
			return recordedRepo();
		}
		return Response.json({
			data: {
				repository: { nameWithOwner: repo, autoMergeAllowed: false },
			},
		});
	}
	return unrecorded(input);
};

const publicPort = Number(process.argv[2] ?? "4197");
const appPort = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once("error", reject);
	probe.listen(0, "127.0.0.1", () => {
		const address = probe.address();
		if (address === null || typeof address === "string") {
			reject(new Error("card lane proof has no app port"));
			return;
		}
		const chosen = address.port;
		probe.close(() => resolve(chosen));
	});
});

void serveRecorded({
	prefix: "project-flow-card-lanes-",
	port: String(appPort),
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: process.argv[3] === "dark" ? "dark" : "light",
		projectViews: {
			[repo]: {
				openView: "board",
				groupBy: "none",
				maxAgeDays: { Done: 0 },
			},
		},
	},
	fetch: recorded,
}).catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});

Bun.serve({
	hostname: "127.0.0.1",
	port: publicPort,
	async fetch(request) {
		const url = new URL(request.url);
		const target = `http://127.0.0.1:${String(appPort)}${url.pathname}${url.search}`;
		for (let attempt = 0; attempt < 50; attempt += 1) {
			try {
				return await fetch(target);
			} catch {
				await Bun.sleep(100);
			}
		}
		return new Response("card lane proof app did not listen", { status: 503 });
	},
});
