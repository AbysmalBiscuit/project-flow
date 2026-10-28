import { expect, test } from "bun:test";

import type { Fetch } from "../src/fetch.ts";
import { githubFetch, issue, type Sent, serve } from "./replies-github-fake.ts";
import { urlOf } from "./support/fetch.ts";
import { readOverview, settledOverview } from "./support/reads.ts";

type Overview = {
	polling?: true;
	projects: { name: string; error: string | null }[];
};

function widgetError(overview: Overview): string | null | undefined {
	return overview.projects.find((project) => project.name === "acme/widget")
		?.error;
}

async function pollUntil(
	base: string,
	done: (overview: Overview) => boolean,
): Promise<Overview> {
	const refresh = await fetch(new URL("/api/refresh", base), {
		method: "POST",
	});
	expect(refresh.status).toBe(204);
	while (true) {
		const overview = await settledOverview(base, readOverview<Overview>);
		if (done(overview)) {
			return overview;
		}
		await Bun.sleep(20);
	}
}

test("a tracker request that never answers fails its project's poll, and a later poll succeeds", async () => {
	const sent: Sent[] = [];
	const recorded = githubFetch(sent, { issues: [issue(7)] });
	let hanging = false;
	const neverAnswers: Fetch = (input, init) => {
		const body = typeof init?.body === "string" ? init.body : "";
		const readsWidget =
			urlOf(input).includes("acme/widget") || body.includes("widget");
		if (hanging && readsWidget) {
			return new Promise<Response>(() => {});
		}
		return recorded(input, init);
	};
	const app = await serve(
		neverAnswers,
		JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		{ trackerRequestLimitMs: 200 },
	);
	try {
		const first = await settledOverview(app.base, readOverview<Overview>);
		expect(widgetError(first)).toBeNull();

		hanging = true;
		const failed = await pollUntil(
			app.base,
			(overview) => widgetError(overview) !== null,
		);
		expect(widgetError(failed)).toStartWith(
			"tracker request timed out after 0.2 s",
		);

		hanging = false;
		const recovered = await pollUntil(
			app.base,
			(overview) => widgetError(overview) === null,
		);
		expect(widgetError(recovered)).toBeNull();
	} finally {
		await app.stop();
	}
});
