import { describe, expect, test } from "bun:test";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { withServer } from "../support/app.ts";
import { type TrackerRequest, urlOf } from "../support/fetch.ts";
import {
	page,
	pull,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { readOverview } from "../support/reads.ts";

const linearProject = "widget-launch-0d42ae5d46d0";

const env = {
	GITHUB_TOKEN: "recorded-token",
	LINEAR_API_KEY: "recorded-linear-key",
};

function attachedIssue(number: number, url: string, sourceType: string | null) {
	return {
		identifier: `WID-${number}`,
		title: `Linear ticket ${number}`,
		updatedAt: "2026-10-01T00:00:00.000Z",
		state: { type: "unstarted" },
		attachments: { nodes: [{ url, title: `Link ${number}`, sourceType }] },
	};
}

const github: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return page({ login: "lev" });
	}
	const number = url.match(/\/repos\/acme\/widget\/pulls\/(\d+)$/)?.[1];
	if (number !== undefined) {
		return page(pull(Number(number)));
	}
	if (url.includes("/commits/") && !url.includes("/check-runs")) {
		return page({ commit: { committer: { date: "2026-10-01T00:00:00Z" } } });
	}
	return recordedOrEmpty(url) ?? unrecorded(input);
};

async function ticketPulls(base: string) {
	const project = (await readOverview<Overview>(base)).projects[0];
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(project?.name ?? "")}`, base),
	);
	expect(response.status).toBe(200);
	const report = (await response.json()) as {
		tickets: { key: string; pull?: string }[];
	};
	return {
		error: project?.error,
		states: project?.tickets.map(({ key, state }) => ({ key, state })),
		pulls: report.tickets.map(({ key, pull }) => ({ key, pull })),
	};
}

describe("Linear attachments", () => {
	test("a GitHub attachment shows its PR and moves the ticket forward, whatever its source type", async () => {
		await withServer(
			linearFake({
				issues: [
					attachedIssue(8, `https://github.com/${repo}/pull/83`, "github"),
					attachedIssue(9, `https://github.com/${repo}/pull/84`, null),
				],
				github,
			}),
			3600,
			async (base) => {
				expect(await ticketPulls(base)).toEqual({
					error: null,
					states: [
						{ key: "WID-8", state: "awaitingMerge" },
						{ key: "WID-9", state: "awaitingMerge" },
					],
					pulls: [
						{ key: "WID-8", pull: `${repo}#83` },
						{ key: "WID-9", pull: `${repo}#84` },
					],
				});
			},
			[{ tracker: "linear", project: linearProject }],
			env,
		);
	});

	test("an attachment URL on an unknown host leaves the ticket in its tracker status", async () => {
		const sent: TrackerRequest[] = [];
		await withServer(
			linearFake({
				issues: [
					attachedIssue(
						8,
						"https://gitlab.example.com/acme/widget/-/merge_requests/83",
						"gitlab",
					),
					attachedIssue(
						9,
						`https://github.example.com/${repo}/pull/84`,
						"github",
					),
					attachedIssue(10, "not a url", null),
				],
				sent,
				github,
			}),
			3600,
			async (base) => {
				expect(await ticketPulls(base)).toEqual({
					error: null,
					states: [
						{ key: "WID-8", state: "backlog" },
						{ key: "WID-9", state: "backlog" },
						{ key: "WID-10", state: "backlog" },
					],
					pulls: [
						{ key: "WID-8", pull: undefined },
						{ key: "WID-9", pull: undefined },
						{ key: "WID-10", pull: undefined },
					],
				});
				const urls = sent.map(({ url }) => url);
				expect(urls.filter((url) => url.includes("example.com"))).toEqual([]);
				expect(urls.filter((url) => url.includes("/pulls"))).toEqual([]);
			},
			[{ tracker: "linear", project: linearProject }],
			env,
		);
	});
});
