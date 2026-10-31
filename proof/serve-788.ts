import type { Fetch } from "../src/fetch.ts";
import recordedRefusal from "../test/fixtures/github-pull-merge-refused.json";
import recordedMerge from "../test/fixtures/github-pull-merge.json";
import { answerRecordedRepoRead } from "../test/recorded-read.ts";
import { urlOf } from "../test/support/fetch.ts";
import { page, recordedDiscovery } from "../test/support/github.ts";
import { repoReadFromLists } from "../test/support/repo-read.ts";
import { serveRecorded } from "./recorded.ts";

const repo = "acme/widget";

const passed = { name: "ci", status: "completed", conclusion: "success" };

function pull(number: number, title: string, body: string, checks: unknown[]) {
	return {
		number,
		title,
		state: "open",
		html_url: `https://github.com/${repo}/pull/${number}`,
		head: { ref: `${number - 40}-work`, sha: `sha-${number}` },
		base: { ref: "main" },
		body,
		merged_at: null as string | null,
		checkRows: checks,
	};
}

const question = `Closes #3

### Important Questions

<details><summary><b>1. redefines the scope:</b> Should the widget ship?</summary>

The widget changes its scope.

</details>
`;

const pulls = [
	pull(41, "Merges", "Closes #1", [passed]),
	pull(42, "Check pending", "Closes #2", [
		{ name: "ci", status: "in_progress", conclusion: null },
	]),
	pull(43, "Open question", question, [passed]),
	pull(44, "GitHub refuses", "Closes #4", [passed]),
];

const issues = pulls.map(({ number, title }) => ({
	number: number - 40,
	title,
	state: "open",
	updated_at: "2026-10-01T00:00:00Z",
	body: "",
	labels: [],
}));

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if ((init?.method ?? "GET").toUpperCase() === "PUT") {
		console.error(`PUT ${url} ${String(init?.body)}`);
		if (url.endsWith("/pulls/44/merge")) {
			return Response.json(recordedRefusal, { status: 405 });
		}
		const merged = pulls.find((item) =>
			url.endsWith(`/pulls/${item.number}/merge`),
		);
		if (merged !== undefined) {
			merged.merged_at = "2026-10-18T12:00:00.000Z";
			merged.state = "closed";
		}
		return Response.json(recordedMerge);
	}
	const shownIssue = issues.find((item) =>
		url.endsWith(`/issues/${item.number}`),
	);
	if (shownIssue !== undefined) {
		return Response.json({
			...shownIssue,
			html_url: `https://github.com/${repo}/issues/${shownIssue.number}`,
		});
	}
	const read = repoReadFromLists(
		input,
		init,
		{ [repo]: issues },
		{ [repo]: pulls },
	);
	if (read !== null) {
		return read;
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({ data: {} });
	}
	return url.includes("/repos/") ? page([]) : Response.json({ data: {} });
};

await serveRecorded({
	prefix: "project-flow-proof-788-",
	port: "0",
	config: { pinned: [{ tracker: "github", repo }], pmBot: { [repo]: false } },
	fetch: answerRecordedRepoRead(recorded),
});
