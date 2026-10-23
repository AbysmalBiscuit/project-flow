import { expect, test } from "bun:test";
import type { Fetch } from "../src/fetch.ts";
import { githubFetch, issue, type Sent, serve } from "./replies-github-fake.ts";
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
