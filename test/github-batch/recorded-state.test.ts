import { describe, expect, test } from "bun:test";

import { emptyPage, renamed, startCounted } from "./_support.ts";

describe("batched GitHub reads", () => {
	test("the overview shows the recorded GraphQL review, check and reaction state", async () => {
		const { overview, needsYou } = await startCounted(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/widget" }] }),
			(owner, name) => renamed(owner, name),
		);
		const project = overview.projects.find(
			(item) => item.name === "acme/widget",
		);
		expect(
			(project?.tickets ?? []).flatMap((ticket) =>
				ticket.key === null ? [] : [[ticket.key, ticket.state] as const],
			),
		).toEqual([
			["acme/widget#101", "awaitingMerge"],
			["acme/widget#102", "inReview"],
		]);
		expect(
			needsYou.map((item) => ({
				key: item.key,
				ci: item.pull?.ci,
				review: item.pull?.review,
			})),
		).toEqual([
			{
				key: "acme/widget#101",
				ci: "passing",
				review: "completed",
			},
		]);
	});

	test("a merged pull keeps its head SHA and an empty closing set", async () => {
		const head = "b".repeat(40);
		const { overview, needsYou } = await startCounted(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				expectedBots: { "acme/widget": ["grok"] },
			}),
			(owner, name) => {
				const body = renamed(owner, name);
				const open = structuredClone(
					body.data.repository.openPullRequests.nodes[0],
				);
				const merged = body.data.repository.mergedPullRequests.nodes[0];
				if (open !== undefined) {
					open.number = 3;
					open.headRefOid = head;
					open.body = "";
					open.closingIssuesReferences = {
						nodes: [],
						pageInfo: emptyPage.pageInfo,
					};
					open.reviews = {
						nodes: [
							{
								author: { login: "grok-code-review[bot]" },
								commit: { oid: head },
								state: "APPROVED",
							},
						],
						pageInfo: emptyPage.pageInfo,
					};
				}
				body.data.repository.openPullRequests.nodes =
					open === undefined ? [] : [open];
				if (merged !== undefined) {
					merged.headRefOid = head;
					merged.body = "Closes #101";
					merged.closingIssuesReferences = {
						nodes: [{ number: 101 }],
						pageInfo: emptyPage.pageInfo,
					};
					merged.reviews = open?.reviews ?? merged.reviews;
				}
				body.data.repository.issues.nodes = [];
				return body;
			},
		);
		expect(overview.projects[0]?.done).toBe(0);
		expect(
			overview.projects[0]?.unlinkedPrs.map((pull) => pull.number),
		).toEqual([3]);
		expect(needsYou.find((item) => item.pull?.number === 3)?.pull?.review).toBe(
			"approved",
		);
	});

	test("a GraphQL NOT_PLANNED issue sits in Dropped", async () => {
		const { overview } = await startCounted(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/widget" }] }),
			(owner, name) => {
				const body = renamed(owner, name);
				const closed = body.data.repository.issues.nodes[0];
				if (closed !== undefined) {
					closed.number = 12;
					closed.title = "Not planned";
					closed.state = "CLOSED";
					closed.stateReason = "NOT_PLANNED";
				}
				body.data.repository.issues.nodes =
					closed === undefined ? [] : [closed];
				body.data.repository.openPullRequests.nodes = [];
				body.data.repository.mergedPullRequests.nodes = [];
				return body;
			},
		);
		const project = overview.projects.find(
			(item) => item.name === "acme/widget",
		);
		expect(
			project?.tickets.find((ticket) => ticket.key === "acme/widget#12"),
		).toEqual(
			expect.objectContaining({ lane: "Dropped", statusType: "dropped" }),
		);
		expect(project?.statusTypes.dropped).toBe(1);
		expect(project?.statusTypes.done).toBe(0);
	});
});
