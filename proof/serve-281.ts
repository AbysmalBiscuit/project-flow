import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import projectFields from "../test/fixtures/github-project-fields.json";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import { proofStops } from "./lifetime.ts";
import { emptyLinear, unrecorded } from "./recorded.ts";

const repo = "acme/widget";
const boardId = "PVT_widget";
const fixtureDir = join(import.meta.dir, "../test/fixtures");

async function fixture(name: string): Promise<Record<string, unknown>> {
	const parsed = JSON.parse(await readFile(join(fixtureDir, name), "utf8"));
	if (Array.isArray(parsed)) {
		const first = parsed[0];
		if (first !== null && typeof first === "object") {
			return first as Record<string, unknown>;
		}
	}
	if (parsed !== null && typeof parsed === "object") {
		return parsed as Record<string, unknown>;
	}
	throw new Error(`recorded ${name} has no object`);
}

const issue = await fixture("github-issues.json");
const pull = await fixture("github-open-pulls.json");

function recordedStatusOptions(body: typeof projectFields) {
	for (const field of body.data.node.fields.nodes) {
		if (!("name" in field) || field.name !== "Status") {
			continue;
		}
		return field.options;
	}
	throw new Error("recorded project Status field is missing");
}

function boardOptionId(name: string): string | undefined {
	const collapsed = name.trim().replace(/\s+/g, " ");
	return recordedStatusOptions(projectFields).find(
		(option) => option.name.trim().replace(/\s+/g, " ") === collapsed,
	)?.id;
}

function boardItem(
	status: { name: string; color: string },
	field: { updatedAt?: string; optionId?: string },
	contentFields: Record<string, unknown>,
): Record<string, unknown> {
	return {
		fieldValueByName: {
			name: status.name,
			optionId:
				field.optionId ?? boardOptionId(status.name) ?? `opt-${status.name}`,
			color: status.color,
			...(field.updatedAt === undefined ? {} : { updatedAt: field.updatedAt }),
		},
		content: {
			__typename: "Issue",
			id: "I_205",
			number: 205,
			title: String(issue.title),
			body: "",
			comments: { totalCount: 0 },
			repository: { nameWithOwner: repo },
			milestone: null,
			labels: { nodes: [] },
			parent: null,
			blockedBy: {
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
			...contentFields,
		},
	};
}

const openItem = boardItem(
	{ name: "In review", color: "PURPLE" },
	{ updatedAt: "2026-10-20T21:14:10Z" },
	{
		state: "OPEN",
		stateReason: null,
		updatedAt: "2026-10-20T21:14:10Z",
		closedByPullRequestsReferences: {
			nodes: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		},
	},
);

const doneOptionId = boardOptionId("Done");
if (doneOptionId === undefined) {
	throw new Error("recorded project Done option is missing");
}

const closedItem = boardItem(
	{ name: "Done", color: "ORANGE" },
	{ updatedAt: "2026-10-21T12:00:00Z", optionId: doneOptionId },
	{
		state: "CLOSED",
		stateReason: "COMPLETED",
		updatedAt: "2026-10-21T12:00:00Z",
		closedByPullRequestsReferences: {
			nodes: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		},
	},
);

const mergedPull = {
	...pull,
	state: "closed",
	closed_at: "2026-10-21T11:52:35Z",
	merged_at: "2026-10-21T11:52:35Z",
	updated_at: "2026-10-21T11:52:35Z",
	html_url: `https://github.com/${repo}/pull/206`,
};

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

let polls = 0;
let releaseRefresh = () => {};
const refreshed = new Promise<void>((resolve) => {
	releaseRefresh = resolve;
});

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url === `https://api.github.com/repos/${repo}`) {
		return Response.json({ allow_auto_merge: false });
	}
	const linear = emptyLinear(url);
	if (linear !== null) {
		return linear;
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("ProjectByNumber")
	) {
		return Response.json({
			data: {
				repositoryOwner: {
					projectV2: {
						id: boardId,
						number: 4,
						title: "Widget board",
						closed: false,
						updatedAt: "2026-08-18T12:00:00Z",
					},
				},
			},
		});
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("ProjectFields")
	) {
		return Response.json(projectFields);
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("ProjectItems")
	) {
		polls += 1;
		if (polls > 1) {
			await refreshed;
		}
		return Response.json({
			data: {
				node: {
					items: {
						nodes: [polls > 1 ? closedItem : openItem],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	if (url === `https://api.github.com/repos/${repo}/pulls/206`) {
		return Response.json(mergedPull);
	}
	if (url.includes("/pulls?")) {
		const closed = url.includes("state=closed");
		if (polls > 1 && closed) {
			return page([mergedPull]);
		}
		return page([]);
	}
	if (
		url.includes("/labels?") ||
		url.includes("/branches?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/issues?")
	) {
		return page([]);
	}
	if (url.includes("/check-runs")) {
		return Response.json({
			check_runs: [
				{
					name: "ci",
					status: "in_progress",
					conclusion: null,
				},
			],
		});
	}
	return unrecorded(input);
};

const port = Number(process.argv[2] ?? process.env.PORT ?? "4281");
const startedAt = Date.now();
const dir = await mkdtemp(join("/var/tmp", "project-flow-281-"));
const configPath = join(dir, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		pinned: [{ tracker: "github", owner: "acme", project: 4 }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			"Widget board": {
				openView: "board",
				groupBy: "none",
				shownLanes: ["In review", "Done"],
			},
		},
	})}\n`,
);

let upstream: URL | null = null;

function upstreamUrl(request: Request): URL | null {
	const target = upstream;
	if (target === null) {
		return null;
	}
	const url = new URL(request.url);
	url.protocol = target.protocol;
	url.hostname = target.hostname;
	url.port = target.port;
	return url;
}

const gate = Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/proof/refresh") {
			releaseRefresh();
			return new Response("refreshed", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}
		const next = upstreamUrl(request);
		if (next === null) {
			return new Promise(() => {});
		}
		if (url.pathname === "/api/refresh" && request.method === "POST") {
			releaseRefresh();
		}
		const headers = new Headers(request.headers);
		headers.delete("host");
		const hasBody = request.method !== "GET" && request.method !== "HEAD";
		return fetch(next, {
			method: request.method,
			headers,
			...(hasBody ? { body: request.body } : {}),
		});
	},
});

console.log(gate.url.href);

const heard = new Promise<string>((resolve, reject) => {
	const timer = setTimeout(() => {
		reject(new Error("recorded app did not listen"));
	}, 15_000);
	void run(["--config", configPath, "--host", "127.0.0.1", "--port", "0"], {
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
			XDG_DATA_HOME: dir,
		},
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(dir, "project-flow.sqlite"),
		now: () =>
			new Date(
				Date.parse("2026-10-22T00:00:00.000Z") + (Date.now() - startedAt),
			),
		stdout: (line) => {
			clearTimeout(timer);
			resolve(line);
		},
		stderr: (line) => console.error(line),
		waitForStop: proofStops(),
	}).then(
		(result) => {
			clearTimeout(timer);
			reject(new Error(`recorded app exited ${result.exitCode}`));
		},
		(error: unknown) => {
			clearTimeout(timer);
			reject(error);
		},
	);
});

upstream = new URL(await heard);
