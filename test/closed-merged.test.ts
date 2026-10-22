import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import projectFields from "./fixtures/github-project-fields.json";
import {
	recordedDiscovery,
	settledOverview,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const fixtureDir = join(import.meta.dir, "fixtures");
const githubRepo = "acme/widget";
const boardId = "PVT_widget";

function recordedStatusOptions(body: typeof projectFields) {
	for (const field of body.data.node.fields.nodes) {
		if (!("name" in field) || field.name !== "Status") {
			continue;
		}
		return field.options;
	}
	throw new Error("recorded project Status field is missing");
}

const githubStatusOptions = recordedStatusOptions(projectFields);

function boardOptionId(name: string): string | undefined {
	const collapsed = name.trim().replace(/\s+/g, " ");
	return githubStatusOptions.find(
		(option) => option.name.trim().replace(/\s+/g, " ") === collapsed,
	)?.id;
}

function page(items: unknown): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function boardItem(
	number: number,
	title: string,
	status: { name: string; color: string },
	field: { updatedAt?: string; optionId?: string } = {},
	contentFields: Record<string, unknown> = {},
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
			id: `I_${number}`,
			number,
			title,
			state: "OPEN",
			stateReason: null,
			updatedAt: "2026-08-18T12:00:00Z",
			...contentFields,
			body: "",
			comments: { totalCount: 0 },
			repository: { nameWithOwner: githubRepo },
			milestone: null,
			labels: { nodes: [] },
			parent: null,
			closedByPullRequestsReferences: {
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
			blockedBy: {
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	};
}

function boardFetch(
	items: () => Record<string, unknown>[],
	closed: () => Record<string, unknown>[] = () => [],
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url === `https://api.github.com/repos/${githubRepo}`) {
			return Response.json({ allow_auto_merge: false });
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
			return Response.json({
				data: {
					node: {
						items: {
							nodes: items(),
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		const pulls = closed();
		const pullMatch = url.match(
			new RegExp(
				`^https://api\\.github\\.com/repos/${githubRepo}/pulls/(\\d+)$`,
			),
		);
		if (pullMatch !== null) {
			const number = Number(pullMatch[1]);
			const pull = pulls.find((item) => item.number === number);
			return pull === undefined ? unrecorded(input) : Response.json(pull);
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=closed&per_page=10&page=1`
		) {
			return page(pulls.filter((item) => item.state === "closed"));
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=open&per_page=100&page=1`
		) {
			return page(pulls.filter((item) => item.state === "open"));
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/labels?") ||
			url.includes("/branches?") ||
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions")
		) {
			return page([]);
		}
		if (url.includes("/check-runs")) {
			return Response.json({ check_runs: [] });
		}
		return unrecorded(input);
	};
}

type FlightItem = {
	key: string | null;
	state: string;
	lane: string;
	statusType: string;
	pull?: string;
};

test("a stored open ticket moves to done when a later poll closes it with a merged PR", async () => {
	const issues = JSON.parse(
		await readFile(join(fixtureDir, "github-issues.json"), "utf8"),
	) as Record<string, unknown>[];
	const pulls = JSON.parse(
		await readFile(join(fixtureDir, "github-open-pulls.json"), "utf8"),
	) as Record<string, unknown>[];
	const issue = issues[0];
	const pull = pulls[0];
	if (issue === undefined || pull === undefined) {
		throw new Error("recorded #205 and #206 responses are missing");
	}
	let closed = false;
	const openItem = boardItem(
		205,
		String(issue.title),
		{ name: "In review", color: "PURPLE" },
		{ updatedAt: "2026-10-20T21:14:10Z" },
		{
			state: "OPEN",
			stateReason: null,
			updatedAt: "2026-10-20T21:14:10Z",
			closedByPullRequestsReferences: {
				nodes: [
					{
						number: 206,
						repository: { nameWithOwner: githubRepo },
					},
				],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	);
	const closedItem = boardItem(
		205,
		String(issue.title),
		{ name: "Done", color: "ORANGE" },
		{
			updatedAt: "2026-10-21T12:00:00Z",
			optionId: boardOptionId("Done"),
		},
		{
			state: "CLOSED",
			stateReason: "COMPLETED",
			updatedAt: "2026-10-21T12:00:00Z",
		},
	);
	const openPull = {
		...pull,
		state: "open",
		closed_at: null,
		merged_at: null,
		html_url: `https://github.com/${githubRepo}/pull/206`,
	};
	const mergedPull = {
		...pull,
		state: "closed",
		closed_at: "2026-10-21T11:52:35Z",
		merged_at: "2026-10-21T11:52:35Z",
		updated_at: "2026-10-21T11:52:35Z",
		html_url: `https://github.com/${githubRepo}/pull/206`,
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
	let now = Date.parse("2026-10-22T00:00:00.000Z");
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			check(base).then(resolve).catch(reject);
		};
	});
	const readTicket = async (base: string) => {
		const response = await fetch(new URL("/api/projects/Widget%20board", base));
		expect(response.status).toBe(200);
		const report = (await response.json()) as {
			tickets?: FlightItem[];
			polling?: true;
		};
		return report.tickets?.find((item) => item.key === `${githubRepo}#205`);
	};
	const check = async (base: string) => {
		const stored = await readTicket(base);
		expect(stored).toMatchObject({
			state: "inReview",
			lane: "In review",
			statusType: "inReview",
			updatedAt: "2026-10-20T21:14:10Z",
		});
		closed = true;
		now += 11 * 60 * 1000;
		const refresh = await fetch(new URL("/api/refresh", base), {
			method: "POST",
		});
		expect(refresh.status).toBe(204);
		const found = await settledOverview(base, readTicket);
		expect(found).toMatchObject({
			state: "done",
			lane: "Done",
			statusType: "done",
			updatedAt: "2026-10-21T12:00:00Z",
		});
	};
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: boardFetch(
					() => [closed ? closedItem : openItem],
					() => [closed ? mergedPull : openPull],
				),
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
				now: () => new Date(now),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});
