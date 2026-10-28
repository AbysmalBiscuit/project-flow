import { describe, expect, test } from "bun:test";

import type { ProjectReport, TicketView } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import {
	daemon,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	serve,
} from "../support/factory.ts";
import { json, trackerRequest, urlOf } from "../support/fetch.ts";
import {
	issuesResponse,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	ticket,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { runClockStart } from "./_support.ts";

const readyLabel = "ready-for-agent";

type TrackerWrite = { url: string; body: string };

/** Records each request of the app to a tracker, except a GET and a GraphQL query. */
function trackerWrites(writes: TrackerWrite[], other: Fetch): Fetch {
	return async (input, init) => {
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? init.body : "";
		const { query } = trackerRequest(input, init);
		if (method !== "GET" && !/^\s*(query\b|\{)/.test(query)) {
			writes.push({ url: urlOf(input), body });
		}
		return other(input, init);
	};
}

/**
 * A hub with the recorded runs, and a tracked repo with the open issues `numbers`.
 * Issue 41 has a running run, and issue 40 a succeeded run. Issue 43 has no run.
 */
async function serveGithub(
	numbers: number[],
	options: {
		closed?: number[];
		readyLabel?: string;
		args?: string[];
		labels?: Record<number, string[]>;
	} = {},
) {
	const labels = new Map<number, string[]>(
		Object.entries(options.labels ?? {}).map(([number, names]) => [
			Number(number),
			names,
		]),
	);
	const writes: TrackerWrite[] = [];
	const requests: FactoryRequest[] = [];
	const tracker: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const added = url.match(/\/repos\/acme\/widget\/issues\/(\d+)\/labels$/);
		if (added !== null && init?.method === "POST") {
			const number = Number(added[1]);
			const sent = JSON.parse(String(init.body)) as { labels: string[] };
			labels.set(number, [...(labels.get(number) ?? []), ...sent.labels]);
			return json(
				(labels.get(number) ?? []).map((name) => ({ name })),
				200,
			);
		}
		const listed = issuesResponse(
			input,
			init,
			numbers.map((number) => ({
				...ticket(
					number,
					"2026-10-25T09:00:00Z",
					options.closed?.includes(number) === true ? "closed" : "open",
				),
				labels: labels.get(number) ?? [],
			})),
			repo,
		);
		return listed ?? recordedOrEmpty(url) ?? unrecorded(input, init);
	};
	const app = await serve(
		options.args ?? [],
		{
			pinned: [{ tracker: "github", repo }],
			factories: [
				{
					name: "work hub",
					url: hubUrl,
					...(options.readyLabel === undefined
						? {}
						: { readyLabel: options.readyLabel }),
				},
			],
		},
		factoryFetch({ [hubUrl]: hub }, requests, trackerWrites(writes, tracker)),
		{
			env: { GITHUB_TOKEN: "recorded-token" },
			now: () => new Date(runClockStart),
		},
	);
	return { ...app, writes };
}

function startRun(base: string, tracker: string, project: string, key: string) {
	return fetch(new URL("/api/run-starts", base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ tracker, project, key }),
	});
}

async function ticketWhere(
	base: string,
	project: string,
	key: string,
	accept: (view: TicketView) => boolean,
): Promise<TicketView> {
	while (true) {
		const response = await fetch(
			new URL(`/api/projects/${encodeURIComponent(project)}`, base),
		);
		if (response.ok) {
			const report = (await response.json()) as ProjectReport;
			const view = report.tickets.find((item) => item.key === key);
			if (view !== undefined && accept(view)) {
				return view;
			}
		}
		await Bun.sleep(20);
	}
}

describe("run starts", () => {
	test("Start run on an open GitHub ticket adds the ready label of the factory", async () => {
		const app = await serveGithub([43], { readyLabel });
		try {
			const key = `${repo}#43`;
			expect(
				(await ticketWhere(app.base, repo, key, (view) => view.title !== ""))
					.runStart,
			).toEqual({ factory: "work hub", label: readyLabel });
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(200);
			expect(app.writes).toEqual([
				{
					url: `https://api.github.com/repos/${repo}/issues/43/labels`,
					body: JSON.stringify({ labels: [readyLabel] }),
				},
			]);
			const requested = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.runStart?.requested === true,
			);
			expect(requested.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
				requested: true,
			});
		} finally {
			await app.stop();
		}
	});

	test("a ticket whose newest run succeeded can start a run, and a ticket with a live run cannot", async () => {
		const app = await serveGithub([40, 41], { readyLabel });
		try {
			const succeeded = await ticketWhere(
				app.base,
				repo,
				`${repo}#40`,
				(view) => view.factoryRun !== undefined,
			);
			expect(succeeded.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
			});
			const live = await ticketWhere(
				app.base,
				repo,
				`${repo}#41`,
				(view) => view.factoryRun !== undefined,
			);
			expect(live.runStart).toBeUndefined();
			const response = await startRun(app.base, "github", repo, `${repo}#41`);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a ready label kept after a succeeded run allows a new start, and the new request refuses a second one", async () => {
		const key = `${repo}#40`;
		const app = await serveGithub([40], {
			readyLabel,
			labels: { 40: [readyLabel] },
		});
		try {
			const kept = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.factoryRun !== undefined,
			);
			expect(kept.runStart).toEqual({ factory: "work hub", label: readyLabel });
			const started = await startRun(app.base, "github", repo, key);
			expect(started.status).toBe(200);
			expect(app.writes).toHaveLength(1);
			const requested = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.runStart?.requested === true,
			);
			expect(requested.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
				requested: true,
			});
			const again = await startRun(app.base, "github", repo, key);
			expect(again.status).toBe(409);
			expect(app.writes).toHaveLength(1);
		} finally {
			await app.stop();
		}
	});

	test("a ready label on a ticket with no run shows the run as requested and refuses a second start", async () => {
		const key = `${repo}#43`;
		const app = await serveGithub([43], {
			readyLabel,
			labels: { 43: [readyLabel] },
		});
		try {
			const view = await ticketWhere(
				app.base,
				repo,
				key,
				(item) => item.title !== "",
			);
			expect(view.runStart).toEqual({
				factory: "work hub",
				label: readyLabel,
				requested: true,
			});
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a closed ticket refuses the start and sends no tracker write", async () => {
		const app = await serveGithub([43], { readyLabel, closed: [43] });
		try {
			const key = `${repo}#43`;
			const closed = await ticketWhere(
				app.base,
				repo,
				key,
				(view) => view.title !== "",
			);
			expect(closed.runStart).toBeUndefined();
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a factory without readyLabel refuses the start and sends no tracker write", async () => {
		const app = await serveGithub([43]);
		try {
			const key = `${repo}#43`;
			const view = await ticketWhere(
				app.base,
				repo,
				key,
				(item) => item.title !== "",
			);
			expect(view.runStart).toBeUndefined();
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a --factory list without readyLabel refuses the start, though the configured factory has one", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			args: ["--factory", `flag hub=${hubUrl}`],
		});
		try {
			const key = `${repo}#43`;
			const view = await ticketWhere(
				app.base,
				repo,
				key,
				(item) => item.title !== "",
			);
			expect(view.runStart).toBeUndefined();
			const response = await startRun(app.base, "github", repo, key);
			expect(response.status).toBe(409);
			expect(app.writes).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("Start run on a Linear ticket adds the team's ready label", async () => {
		const writes: TrackerWrite[] = [];
		const issue = {
			id: "issue-pf-1",
			identifier: "PF-1",
			title: "Ready ticket",
			description: "Body",
			state: { type: "unstarted" },
			updatedAt: "2026-08-18T12:00:00.000Z",
			labels: { nodes: [] },
			comments: { nodes: [] },
			team: { id: "team-pf" },
		};
		const tracker = linearFake({
			project: {
				id: "11111111-1111-4111-8111-111111111111",
				name: "Widget launch",
				slugId: "widget-launch",
			},
			issues: [issue],
			labels: [
				{ id: "label-other-team", name: readyLabel, team: { id: "team-xx" } },
				{ id: "label-pf", name: readyLabel, team: { id: "team-pf" } },
			],
		});
		const app = await serve(
			[],
			{
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				factories: [{ name: "work hub", url: hubUrl, readyLabel }],
			},
			factoryFetch({ [hubUrl]: daemon }, [], trackerWrites(writes, tracker)),
			{ env: { LINEAR_API_KEY: "recorded-linear-key" } },
		);
		try {
			const view = await ticketWhere(
				app.base,
				"Widget launch",
				"PF-1",
				(item) => item.title !== "",
			);
			expect(view.runStart).toEqual({ factory: "work hub", label: readyLabel });
			const response = await startRun(
				app.base,
				"linear",
				"Widget launch",
				"PF-1",
			);
			expect(response.status).toBe(200);
			expect(
				writes.map(
					(write) =>
						(JSON.parse(write.body) as { variables: unknown }).variables,
				),
			).toEqual([{ id: "issue-pf-1", labelId: "label-pf" }]);
			const requested = await ticketWhere(
				app.base,
				"Widget launch",
				"PF-1",
				(item) => item.runStart?.requested === true,
			);
			expect(requested.runStart?.label).toBe(readyLabel);
		} finally {
			await app.stop();
		}
	});
});
