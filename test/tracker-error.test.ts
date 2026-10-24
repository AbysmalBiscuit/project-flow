import { expect, test } from "bun:test";

import type { Fetch } from "../src/fetch.ts";
import {
	githubFetch,
	issue,
	json,
	type Sent,
	serve,
} from "./replies-github-fake.ts";
import { settledOverview, urlOf } from "./support.ts";

const rejected = () => new Response("Bad credentials", { status: 401 });

const trackerErrorShape = /^GitHub [a-z ]+ failed \(HTTP 401\)(: \S+)?$/;

type Overview = {
	polling?: true;
	projects: { name: string; error: string | null }[];
};

async function readOverview(base: string): Promise<Overview> {
	const response = await fetch(new URL("/api/overview", base));
	return (await response.json()) as Overview;
}

test("a tracker 401 on a list path and on a thread path gives one error shape", async () => {
	const sent: Sent[] = [];
	const recorded = githubFetch(sent, { issues: [issue(7)] });
	const failing: Fetch = async (input, init) => {
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/graphql" && body.includes("gadget")) {
			return rejected();
		}
		if (url.includes("/repos/acme/widget/issues/7/comments")) {
			return rejected();
		}
		return recorded(input, init);
	};
	const app = await serve(
		failing,
		JSON.stringify({
			pinned: [
				{ tracker: "github", repo: "acme/widget" },
				{ tracker: "github", repo: "acme/gadget" },
			],
		}),
	);
	try {
		const overview = await settledOverview(app.base, readOverview);
		const listError = overview.projects.find(
			(project) => project.name === "acme/gadget",
		)?.error;
		expect(listError).toMatch(trackerErrorShape);

		const thread = await fetch(
			new URL(
				"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
				app.base,
			),
		);
		const threadBody = (await thread.json()) as Record<string, unknown>;
		expect(thread.status).toBe(401);
		expect(Object.keys(threadBody)).toEqual(["error"]);
		expect(threadBody.error).toMatch(trackerErrorShape);
	} finally {
		await app.stop();
	}
});

const threadUrl = "/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget";

function linkedPullsAnswer(answer: () => Response, sent: Sent[] = []): Fetch {
	return githubFetch(sent, {
		issues: [issue(7)],
		graphql: (query) => (query.includes("LinkedPulls") ? answer() : null),
	});
}

test.each([
	[
		"fails its schema",
		() =>
			json({
				data: {
					repository: {
						issue: { closedByPullRequestsReferences: { nodes: "none" } },
					},
				},
			}),
	],
	["is not JSON", () => new Response("<html>", { status: 200 })],
])("a linked-PR body that %s fails the thread with 502", async (_, answer) => {
	const app = await serve(
		linkedPullsAnswer(answer),
		JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
	);
	try {
		const thread = await fetch(new URL(threadUrl, app.base));
		const body = (await thread.json()) as Record<string, unknown>;
		expect(thread.status).toBe(502);
		expect(Object.keys(body)).toEqual(["error"]);
	} finally {
		await app.stop();
	}
});

test("an unavailable linked-PR read leaves the thread without review comments", async () => {
	const sent: Sent[] = [];
	const app = await serve(
		linkedPullsAnswer(() => new Response("down", { status: 503 }), sent),
		JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
	);
	try {
		const thread = await fetch(new URL(threadUrl, app.base));
		expect(thread.status).toBe(200);
		expect(sent.some((item) => item.url.includes("/pulls/"))).toBe(false);
	} finally {
		await app.stop();
	}
});
