import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedRepoRead from "./fixtures/github-repo-read.json";
import { tempConfig, testIo } from "./support/app.ts";
import { trackerRequest } from "./support/fetch.ts";
import { recordedViewer, unrecorded } from "./support/github.ts";
import {
	openEventStream,
	readOverview,
	settledOverview,
} from "./support/reads.ts";
import { emptyRepoRead } from "./support/repo-read.ts";

type Sent = { url: string; operation: string; repo: string | null };

type Harness = {
	base: string;
	sent: Sent[];
	/** Sets the title that the next `acme/widget` read gives ticket 101. */
	retitle: (title: string) => void;
	/** Holds each `acme/other` read until the returned release runs. */
	holdOther: () => { reached: Promise<void>; release: () => void };
};

function widgetRead(title: string) {
	const body = structuredClone(recordedRepoRead);
	const first = body.data.repository.issues.nodes[0];
	if (first !== undefined) {
		first.title = title;
	}
	return body;
}

/** Starts the app with `acme/widget` and `acme/other` tracked, and runs `body` after the first poll. */
async function withTwoRepos(body: (harness: Harness) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "project-flow-project-refresh-"));
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [
				{ tracker: "github", repo: "acme/widget" },
				{ tracker: "github", repo: "acme/other" },
			],
		}),
	);
	const sent: Sent[] = [];
	let title = "Ticket 101";
	let otherHeld: Promise<void> | null = null;
	let noteOtherReached = () => {};
	const fetchImpl: Fetch = async (input, init) => {
		const viewer = recordedViewer(input, init);
		if (viewer !== null) {
			return viewer;
		}
		const request = trackerRequest(input, init);
		const operation = request.query.match(/^\s*query\s+(\w+)/)?.[1] ?? "";
		const { owner, name } = request.variables;
		const repo =
			typeof owner === "string" && typeof name === "string"
				? `${owner}/${name}`
				: (JSON.stringify(request.variables).match(/acme\/\w+/)?.[0] ?? null);
		sent.push({ url: request.url, operation, repo });
		if (operation !== "RepoRead") {
			return unrecorded(input, init);
		}
		if (repo === "acme/other") {
			noteOtherReached();
			await otherHeld;
			return Response.json(emptyRepoRead("acme", "other"));
		}
		return Response.json(widgetRead(title));
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
			sent,
			retitle: (next) => {
				title = next;
			},
			holdOther: () => {
				let release = () => {};
				otherHeld = new Promise<void>((resolve) => {
					release = resolve;
				});
				const reached = new Promise<void>((resolve) => {
					noteOtherReached = resolve;
				});
				return { reached, release };
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
				now: () => new Date("2026-08-18T12:00:00.000Z"),
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

async function widgetTitles(base: string): Promise<string[]> {
	const response = await fetch(
		new URL(
			`/api/projects/${encodeURIComponent("acme/widget")}?view=all`,
			base,
		),
	);
	const report = (await response.json()) as ProjectReport;
	return report.tickets.map((item) => item.title).sort();
}

function refreshWidget(base: string): Promise<Response> {
	return fetch(
		new URL(`/api/projects/${encodeURIComponent("acme/widget")}/refresh`, base),
		{ method: "POST" },
	);
}

test("a project refresh reads only that project and sends its new rows on the event stream", async () => {
	await withTwoRepos(async ({ base, sent, retitle }) => {
		expect(sent.some((item) => item.repo === "acme/other")).toBe(true);
		sent.length = 0;
		const stream = openEventStream(base);
		await stream.ready;
		retitle("Ticket 101 renamed");
		const response = await refreshWidget(base);
		expect(response.status).toBe(204);
		expect(sent.map((item) => item.operation)).toContain("RepoRead");
		expect(new Set(sent.map((item) => item.repo))).toEqual(
			new Set(["acme/widget"]),
		);
		const events: string[] = [];
		for await (const event of stream.events) {
			events.push(event.event);
			if (event.event !== "overview") {
				continue;
			}
			if ((await widgetTitles(base)).includes("Ticket 101 renamed")) {
				break;
			}
		}
		stream.close();
		expect(events).not.toContain("progress");
		expect(await widgetTitles(base)).toEqual([
			"Ticket 101 renamed",
			"Ticket 102",
		]);
		expect((await readOverview(base)).polling).toBeUndefined();
	});
});

test("a project refresh during a full poll neither waits for it nor queues another, and the poll keeps the newer read", async () => {
	await withTwoRepos(async ({ base, sent, retitle, holdOther }) => {
		const other = holdOther();
		retitle("Ticket 101 in the full poll");
		await fetch(new URL("/api/refresh", base), { method: "POST" });
		await other.reached;
		retitle("Ticket 101 in the project refresh");
		const response = await refreshWidget(base);
		expect(response.status).toBe(204);
		expect((await readOverview(base)).polling).toBe(true);
		expect(await widgetTitles(base)).toContain(
			"Ticket 101 in the project refresh",
		);
		other.release();
		await settledOverview(base, readOverview);
		expect(await widgetTitles(base)).toContain(
			"Ticket 101 in the project refresh",
		);
		const otherReads = sent.filter(
			(item) => item.operation === "RepoRead" && item.repo === "acme/other",
		);
		expect(otherReads).toHaveLength(2);
	});
});

test("the overview refresh still reads every tracked project", async () => {
	await withTwoRepos(async ({ base, sent }) => {
		sent.length = 0;
		await fetch(new URL("/api/refresh", base), { method: "POST" });
		await Bun.sleep(50);
		await settledOverview(base, readOverview);
		expect(
			sent
				.filter((item) => item.operation === "RepoRead")
				.map((item) => item.repo)
				.sort(),
		).toEqual(["acme/other", "acme/widget"]);
	});
});
