import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NeedsYouItem } from "../src/domain.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo } from "./support/app.ts";
import { json, type TrackerRequest, trackerRequest } from "./support/fetch.ts";
import {
	emptyProjectFields,
	head,
	recordedDiscovery,
	repo,
	unrecorded,
} from "./support/github.ts";
import { linearFake } from "./support/linear.ts";

const lastPage = { hasNextPage: false, endCursor: null };

type Page = { nodes: Record<string, unknown>[]; pageInfo: typeof lastPage };

function list(
	nodes: Record<string, unknown>[],
	later: string | null = null,
): Page | { nodes: Record<string, unknown>[]; pageInfo: object } {
	return {
		nodes,
		pageInfo:
			later === null ? lastPage : { hasNextPage: true, endCursor: later },
	};
}

const passing = { name: "ci", status: "COMPLETED", conclusion: "SUCCESS" };

function pullNode(
	number: number,
	lists: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: `PR_${number}`,
		number,
		title: `PR ${number}`,
		url: `https://github.com/${repo}/pull/${number}`,
		isDraft: false,
		body: "",
		state: "OPEN",
		mergedAt: null,
		updatedAt: "2026-10-01T00:00:00Z",
		headRefName: `${number}-feat`,
		baseRefName: "main",
		headRefOid: head,
		autoMergeRequest: null,
		commits: list([{ commit: { committedDate: "2026-10-01T00:00:00Z" } }]),
		closingIssuesReferences: list([]),
		reviews: list([]),
		comments: list([]),
		reactions: list([]),
		statusCheckRollup: { contexts: list([passing]) },
		...lists,
	};
}

/** A linked PR as GitHub answers it: its node, a PR it cannot find, or a repo the token cannot read. */
type Answer = Record<string, unknown> | "missing" | "unreadable";

type Linked = {
	answers: Map<number, Answer>;
	/** The later page of a list, keyed by the node id and the cursor. */
	laterPages?: Map<string, Record<string, unknown>>;
};

function pullsByNumberAnswer(sent: TrackerRequest, linked: Linked): Response {
	const data: Record<string, unknown> = {};
	const errors: { type: string; message: string; path: string[] }[] = [];
	for (const [name, value] of Object.entries(sent.variables)) {
		const at = name.match(/^number(\d+)$/)?.[1];
		if (at === undefined) {
			continue;
		}
		const answer = linked.answers.get(Number(value));
		if (answer === "unreadable" || answer === undefined) {
			data[`p${at}`] = null;
			errors.push({
				type: "NOT_FOUND",
				message: `Could not resolve to a Repository with the name '${repo}'.`,
				path: [`p${at}`],
			});
		} else if (answer === "missing") {
			data[`p${at}`] = { pullRequest: null };
			errors.push({
				type: "NOT_FOUND",
				message: `Could not resolve to a PullRequest with the number of ${value}.`,
				path: [`p${at}`, "pullRequest"],
			});
		} else {
			data[`p${at}`] = { pullRequest: answer };
		}
	}
	return json(errors.length === 0 ? { data } : { data, errors });
}

function laterPagesAnswer(sent: TrackerRequest, linked: Linked): Response {
	const data: Record<string, unknown> = {};
	for (const match of sent.query.matchAll(/c(\d+): node\(id: \$id\d+\)/g)) {
		const at = match[1] ?? "";
		const key = `${String(sent.variables[`id${at}`])}@${String(sent.variables[`after${at}`])}`;
		data[`c${at}`] = linked.laterPages?.get(key) ?? null;
	}
	return json({ data });
}

type Read = {
	sent: TrackerRequest[];
	tickets: { key: string; state: string; pull?: string }[];
	needsYou: NeedsYouItem[];
	error: string | null;
};

/** Starts the app on a Linear project whose ticket WID-n links PR n, and reads the project after the first poll. */
async function readLinked(numbers: number[], linked: Linked): Promise<Read> {
	const slug = "widget-launch-0d42ae5d46d0";
	const sent: TrackerRequest[] = [];
	const linear = linearFake({
		project: { id: "project-1", name: "Widget launch", slugId: slug },
		issues: numbers.map((number) => ({
			identifier: `WID-${number}`,
			title: `Linear ticket ${number}`,
			updatedAt: "2026-10-01T00:00:00.000Z",
			state: { type: "started" },
			attachments: {
				nodes: [
					{
						url: `https://github.com/${repo}/pull/${number}`,
						title: `PR ${number}`,
						sourceType: "github",
					},
				],
			},
		})),
		github: async (input, init) => {
			const request = trackerRequest(input, init);
			sent.push(request);
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (request.query.includes("query PullsByNumber")) {
				return pullsByNumberAnswer(request, linked);
			}
			if (request.query.includes("query RepoPages")) {
				return laterPagesAnswer(request, linked);
			}
			if (request.url === "https://api.github.com/user") {
				return json({ login: "lev" });
			}
			if (request.url.includes("/pulls?state=closed")) {
				return json([]);
			}
			return emptyProjectFields(input, init) ?? unrecorded(input, init);
		},
	});
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "linear", project: slug }],
			expectedBots: { [repo]: [] },
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let ready: (base: string) => void = () => {};
	const started = new Promise<string>((resolve) => {
		ready = resolve;
	});
	let read: Read | null = null;
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: linear,
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: (line) => ready(line),
				waitForStop: (async () => {
					const base = await started;
					const overview = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as { projects: { name: string; error: string | null }[] };
					const project = overview.projects[0];
					const report = (await (
						await fetch(
							new URL(
								`/api/projects/${encodeURIComponent(project?.name ?? "")}`,
								base,
							),
						)
					).json()) as Pick<Read, "tickets">;
					const needsYou = (await (
						await fetch(new URL("/api/needs-you", base))
					).json()) as NeedsYouItem[];
					read = {
						sent: [...sent],
						tickets: report.tickets,
						needsYou,
						error: project?.error ?? null,
					};
				})(),
			}),
		);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr);
		}
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
	if (read === null) {
		throw new Error("the app stopped before the checks read the project");
	}
	return read;
}

const pullsByNumberRequests = (sent: TrackerRequest[]) =>
	sent.filter((request) => request.query.includes("query PullsByNumber"));

const restPullReads = (sent: TrackerRequest[]) =>
	sent.filter((request) =>
		/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/pulls\/\d+/.test(
			request.url,
		),
	);

const pullOf = (read: Read, number: number) =>
	read.needsYou.find((item) => item.key === `WID-${number}`)?.pull;

describe("linked PRs read through GitHub GraphQL", () => {
	test("a Linear project reads its linked PRs in one GraphQL request per chunk", async () => {
		const numbers = Array.from({ length: 45 }, (_, at) => 100 + at);
		const read = await readLinked(numbers, {
			answers: new Map(numbers.map((number) => [number, pullNode(number)])),
		});
		const batches = pullsByNumberRequests(read.sent);
		expect(
			batches.map((request) => Object.keys(request.variables).length / 3),
		).toEqual([40, 5]);
		expect(restPullReads(read.sent)).toEqual([]);
		expect(read.error).toBeNull();
		expect(read.tickets).toHaveLength(45);
		expect(
			read.tickets.filter((ticket) => ticket.pull !== undefined),
		).toHaveLength(45);
	});

	test("the project shows the CI, reviews and needs-you rows of its linked PRs", async () => {
		const read = await readLinked([83, 84, 85], {
			answers: new Map<number, Answer>([
				[
					83,
					pullNode(83, {
						reviews: list([
							{
								author: { login: "ada" },
								commit: { oid: head },
								state: "APPROVED",
							},
						]),
					}),
				],
				[
					84,
					pullNode(84, {
						statusCheckRollup: {
							contexts: list([
								{ name: "ci", status: "COMPLETED", conclusion: "FAILURE" },
							]),
						},
					}),
				],
				[85, pullNode(85, { isDraft: true })],
			]),
		});
		expect(read.tickets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "WID-83", pull: `${repo}#83` }),
				expect.objectContaining({ key: "WID-84", pull: `${repo}#84` }),
				expect.objectContaining({ key: "WID-85", pull: `${repo}#85` }),
			]),
		);
		expect(read.needsYou.map(({ key, reason }) => ({ key, reason }))).toEqual([
			{ key: "WID-83", reason: "awaitingMerge" },
		]);
		expect(pullOf(read, 83)).toMatchObject({
			number: 83,
			ci: "passing",
			review: "approved",
		});
	});

	test("a linked PR with more checks and reviews than one page shows the later items", async () => {
		const approval = {
			author: { login: "ada" },
			commit: { oid: head },
			state: "APPROVED",
		};
		const failing = {
			name: "test",
			status: "COMPLETED",
			conclusion: "FAILURE",
		};
		const read = await readLinked([83, 84, 85], {
			answers: new Map<number, Answer>([
				[83, pullNode(83, { reviews: list([], "reviews-2") })],
				[
					84,
					pullNode(84, {
						statusCheckRollup: { contexts: list([passing], "checks-2") },
					}),
				],
				[
					85,
					pullNode(85, {
						statusCheckRollup: { contexts: list([passing, failing]) },
					}),
				],
			]),
			laterPages: new Map([
				["PR_83@reviews-2", { reviews: list([approval]) }],
				[
					"PR_84@checks-2",
					{ statusCheckRollup: { contexts: list([failing]) } },
				],
			]),
		});
		expect(read.needsYou.map((item) => item.key)).toEqual(["WID-83"]);
		expect(pullOf(read, 83)).toMatchObject({ review: "approved" });
		const stateOf = (key: string) =>
			read.tickets.find((ticket) => ticket.key === key)?.state;
		expect(stateOf("WID-84")).toBe(stateOf("WID-85"));
		expect(stateOf("WID-84")).not.toBe(stateOf("WID-83"));
	});

	test("a malformed later page drops only the PR that owns it", async () => {
		const read = await readLinked([83, 84], {
			answers: new Map<number, Answer>([
				[83, pullNode(83, { reviews: list([], "reviews-2") })],
				[84, pullNode(84)],
			]),
			laterPages: new Map([["PR_83@reviews-2", { reviews: "malformed" }]]),
		});
		expect(read.error).toBeNull();
		expect(read.tickets.map(({ key, pull }) => ({ key, pull }))).toEqual(
			expect.arrayContaining([
				{ key: "WID-83", pull: undefined },
				{ key: "WID-84", pull: `${repo}#84` },
			]),
		);
	});

	test("a linked PR that GitHub cannot find or read does not fail the other PRs of its chunk", async () => {
		const read = await readLinked([83, 84, 85], {
			answers: new Map<number, Answer>([
				[83, pullNode(83)],
				[84, "missing"],
				[85, "unreadable"],
			]),
		});
		expect(pullsByNumberRequests(read.sent)).toHaveLength(1);
		expect(read.error).toBeNull();
		expect(read.tickets.map(({ key, pull }) => ({ key, pull }))).toEqual(
			expect.arrayContaining([
				{ key: "WID-83", pull: `${repo}#83` },
				{ key: "WID-84", pull: undefined },
				{ key: "WID-85", pull: undefined },
			]),
		);
	});
});
