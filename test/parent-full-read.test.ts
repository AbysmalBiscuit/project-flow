import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { refreshSettled } from "./events.ts";
import recordedRepoRead from "./fixtures/github-repo-read.json";
import {
	recordedViewer,
	settledOverview,
	tempConfig,
	testIo,
	trackerRequest,
	unrecorded,
} from "./support.ts";

const parentIssue = {
	number: 102,
	title: "Ticket 102",
	state: "OPEN",
	stateReason: null,
	url: "https://github.com/acme/widget/issues/102",
	repository: { nameWithOwner: "acme/widget" },
};

type Harness = {
	base: string;
	/** The `since` of each `acme/widget` issue read, null for a full read. */
	issueReads: (string | null)[];
	/** Sets the parent that GitHub gives ticket 101, with no change to its `updatedAt`. */
	setParent: (parent: typeof parentIssue | null) => void;
	advance: (ms: number) => void;
};

/**
 * Starts the app on the recorded `acme/widget` repo read. An incremental read
 * lists no issue, as GitHub does when no `updatedAt` changed.
 */
async function withWidget(
	parent: typeof parentIssue | null,
	body: (harness: Harness) => Promise<void>,
) {
	const root = await mkdtemp(join(tmpdir(), "project-flow-parent-read-"));
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "github", repo: "acme/widget" }],
			pollIntervalSeconds: 3600,
		}),
	);
	const issueReads: (string | null)[] = [];
	let parentOf101 = parent;
	let now = Date.parse("2026-08-18T12:00:00.000Z");
	const fetchImpl: Fetch = async (input, init) => {
		const viewer = recordedViewer(input, init);
		if (viewer !== null) {
			return viewer;
		}
		const request = trackerRequest(input, init);
		const operation = request.query.match(/^\s*query\s+(\w+)/)?.[1] ?? "";
		if (operation !== "RepoRead" || !request.query.includes("issues(")) {
			return unrecorded(input, init);
		}
		const since =
			typeof request.variables.since === "string"
				? request.variables.since
				: null;
		issueReads.push(since);
		const read = structuredClone(recordedRepoRead);
		const issues = read.data.repository.issues;
		const first = issues.nodes[0];
		if (first !== undefined) {
			Object.assign(first, { parent: parentOf101 });
		}
		if (since !== null) {
			issues.nodes = [];
		}
		return Response.json(read);
	};
	let finish: () => void = () => {};
	let fail: (error: unknown) => void = () => {};
	const done = new Promise<void>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	const start = async (base: string) => {
		await settledOverview(base, readOverview);
		await body({
			base,
			issueReads,
			setParent: (next) => {
				parentOf101 = next;
			},
			advance: (ms) => {
				now += ms;
			},
		});
	};
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date(now),
				listTodos: async () => "",
				stdout: (base) => {
					start(base).then(finish, fail);
				},
				waitForStop: done,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

async function readOverview(base: string): Promise<{ polling?: true }> {
	return (await (await fetch(new URL("/api/overview", base))).json()) as {
		polling?: true;
	};
}

async function parentOf101(base: string): Promise<string | undefined> {
	const response = await fetch(
		new URL(
			`/api/projects/${encodeURIComponent("acme/widget")}?view=all`,
			base,
		),
	);
	const report = (await response.json()) as ProjectReport;
	return report.tickets.find((ticket) => ticket.key === "acme/widget#101")
		?.parent;
}

const fullReadPeriodMs = 10 * 60 * 1000;

test("a ticket that gets a parent with no new updatedAt shows it after the next full read", async () => {
	await withWidget(null, async ({ base, issueReads, setParent, advance }) => {
		expect(await parentOf101(base)).toBeUndefined();
		setParent(parentIssue);
		await refreshSettled(base);
		expect(issueReads.at(-1)).not.toBeNull();
		expect(await parentOf101(base)).toBeUndefined();
		advance(fullReadPeriodMs);
		await refreshSettled(base);
		expect(issueReads.at(-1)).toBeNull();
		expect(await parentOf101(base)).toBe("acme/widget#102");
	});
});

test("a ticket that loses its parent with no new updatedAt loses it after the next full read", async () => {
	await withWidget(
		parentIssue,
		async ({ base, issueReads, setParent, advance }) => {
			expect(await parentOf101(base)).toBe("acme/widget#102");
			setParent(null);
			await refreshSettled(base);
			expect(await parentOf101(base)).toBe("acme/widget#102");
			advance(fullReadPeriodMs);
			await refreshSettled(base);
			expect(issueReads.at(-1)).toBeNull();
			expect(await parentOf101(base)).toBeUndefined();
		},
	);
});

test("a project refresh of a GitHub project reads all its issues", async () => {
	await withWidget(null, async ({ base, issueReads, setParent }) => {
		await refreshSettled(base);
		expect(issueReads.at(-1)).not.toBeNull();
		setParent(parentIssue);
		const reads = issueReads.length;
		const response = await fetch(
			new URL(
				`/api/projects/${encodeURIComponent("acme/widget")}/refresh`,
				base,
			),
			{ method: "POST" },
		);
		expect(response.status).toBe(204);
		expect(issueReads.slice(reads)).toEqual([null]);
		expect(await parentOf101(base)).toBe("acme/widget#102");
	});
});
