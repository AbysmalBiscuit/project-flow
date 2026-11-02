import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NeedsYouItem } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { json, type TrackerRequest, trackerRequest } from "../support/fetch.ts";
import {
	emptyProjectFields,
	head,
	recordedDiscovery,
	repo,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { settledOverview } from "../support/reads.ts";

const lastPage = { hasNextPage: false, endCursor: null };

type Page = { nodes: Record<string, unknown>[]; pageInfo: typeof lastPage };

export function list(
	nodes: Record<string, unknown>[],
	later: string | null = null,
): Page | { nodes: Record<string, unknown>[]; pageInfo: object } {
	return {
		nodes,
		pageInfo:
			later === null ? lastPage : { hasNextPage: true, endCursor: later },
	};
}

export const passing = {
	name: "ci",
	status: "COMPLETED",
	conclusion: "SUCCESS",
};

export function pullNode(
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
export type Answer = Record<string, unknown> | "missing" | "unreadable";

export type Linked = {
	answers: Map<number, Answer>;
	/** The later page of a list, keyed by the node id and the cursor. */
	laterPages?: Map<string, Record<string, unknown>>;
	/** The REST list of closed PRs that the merged history reads. */
	closed?: Record<string, unknown>[];
	/** Infer the expected bots from the merged history, instead of expecting none. */
	inferBots?: true;
	/** The HTTP status of each `PullsByNumber` answer, when it is not 200. */
	status?: number;
	/** Runs after the first read; the app then polls again and reads the project again. */
	again?: () => void;
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

export type Read = {
	sent: TrackerRequest[];
	tickets: { key: string; state: string; pull?: string }[];
	needsYou: NeedsYouItem[];
	error: string | null;
	/** The read after the first poll, when `again` asked for a second poll. */
	before?: Read;
};

async function readProject(
	base: string,
	sent: TrackerRequest[],
): Promise<Read> {
	const overview = await settledOverview(
		base,
		async (url) =>
			(await (await fetch(new URL("/api/overview", url))).json()) as {
				projects: { name: string; error: string | null }[];
				polling?: true;
			},
	);
	const project = overview.projects[0];
	const report = (await (
		await fetch(
			new URL(`/api/projects/${encodeURIComponent(project?.name ?? "")}`, base),
		)
	).json()) as Pick<Read, "tickets">;
	const needsYou = (await (
		await fetch(new URL("/api/needs-you", base))
	).json()) as NeedsYouItem[];
	return {
		sent: [...sent],
		tickets: report.tickets,
		needsYou,
		error: project?.error ?? null,
	};
}

/** Starts the app on a Linear project whose ticket WID-n links PR n, and reads the project after the first poll. */
export async function readLinked(
	numbers: number[],
	linked: Linked,
): Promise<Read> {
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
				return linked.status === undefined
					? pullsByNumberAnswer(request, linked)
					: new Response("recorded failure", { status: linked.status });
			}
			if (request.query.includes("query RepoPages")) {
				return laterPagesAnswer(request, linked);
			}
			if (request.url === "https://api.github.com/user") {
				return json({ login: "lev" });
			}
			if (request.url.includes("/pulls?state=closed")) {
				return json(linked.closed ?? []);
			}
			return emptyProjectFields(input, init) ?? unrecorded(input, init);
		},
	});
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "linear", project: slug }],
			...(linked.inferBots === true ? {} : { expectedBots: { [repo]: [] } }),
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
					const first = await readProject(base, sent);
					if (linked.again === undefined) {
						read = first;
						return;
					}
					linked.again();
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					read = { ...(await readProject(base, sent)), before: first };
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

export const pullsByNumberRequests = (sent: TrackerRequest[]) =>
	sent.filter((request) => request.query.includes("query PullsByNumber"));

export const pullOf = (read: Read, number: number) =>
	read.needsYou.find((item) => item.key === `WID-${number}`)?.pull;
