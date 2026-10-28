import { describe, expect, test } from "bun:test";

import type { Fetch } from "../../src/fetch.ts";
import recordedProgressComment from "../fixtures/github-progress-comment.json";
import { goodPoll, withServer } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	githubSince,
	issuesResponse,
	listedRead,
	listUrl,
	otherRepo,
	page,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	ticket,
	unrecorded,
} from "../support/github.ts";
import {
	openEventStream,
	type OverviewBody,
	overviewOf,
	readOverview,
	settledOverview,
	settledOverviewEvent,
	type ShownTicket,
} from "../support/reads.ts";
import { githubIssueNode, repoReadIssues } from "../support/repo-read.ts";
import {
	counts,
	githubTicket,
	pushListed,
	unchangedFetch,
} from "./_support.ts";

function changingFetch(requests: string[]): Fetch {
	let polls = 0;
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const listed = listedRead(input, init);
		if (listed !== null && listed.repo === repo) {
			pushListed(requests, listed);
			polls += 1;
			return (
				issuesResponse(
					input,
					init,
					polls === 1
						? [ticket(1, "2026-04-01T00:00:00Z")]
						: [
								ticket(1, "2026-04-02T00:00:00Z", "closed"),
								ticket(2, "2026-04-02T00:00:00Z"),
							],
				) ?? page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
}

function failingAfterGoodPoll(requests: string[]): Fetch {
	let polls = 0;
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const failed = listedRead(input, init);
		if (failed !== null && failed.repo === repo) {
			requests.push(failed.url);
			polls += 1;
			if (polls === 1) {
				return (
					issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
					page([])
				);
			}
			return new Response("recorded failure", { status: 500 });
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
}

function failingThenRecorded(
	requests: string[],
	holdFailure?: Promise<void>,
): Fetch {
	let polls = 0;
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const recovered = listedRead(input, init);
		if (recovered !== null && recovered.repo === repo) {
			pushListed(requests, recovered);
			polls += 1;
			if (polls === 2) {
				await holdFailure;
				return new Response("recorded failure", { status: 500 });
			}
			return (
				issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
				page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
}

describe("live updates", () => {
	test("an empty incremental page keeps the stored tickets", async () => {
		const requests: string[] = [];
		let polls = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const kept = listedRead(input, init);
			if (kept !== null && kept.repo === repo) {
				requests.push(kept.url);
				polls += 1;
				return (
					issuesResponse(
						input,
						init,
						polls === 1 ? [ticket(1, "2026-04-01T00:00:00Z")] : [],
					) ?? page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(fetchImpl, 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = await settledOverview(base, readOverview);
			expect(body.projects).toEqual([
				counts(
					repo,
					1,
					0,
					"github",
					[githubTicket(1, "backlog")],
					"2026-04-01T12:00:01.000Z",
				),
			]);
			expect(body.error).toBeNull();
			const second = new URL(requests[1] ?? "");
			expect(second.searchParams.get("since")).toBe(githubSince(goodPoll));
		});
	});

	test("a failed fetch keeps the stored overview and names the error", async () => {
		const requests: string[] = [];
		await withServer(failingAfterGoodPoll(requests), 3600, async (base) => {
			const stream = openEventStream(base);
			await stream.ready;
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = await settledOverview(base, readOverview);
			expect(body.projects).toEqual([
				counts(
					repo,
					1,
					0,
					"github",
					[githubTicket(1, "backlog")],
					goodPoll,
					body.projects[0]?.error ?? null,
				),
			]);
			expect(body.projects[0]?.error).toContain("HTTP 500");
			expect(body.projects[0]?.error).toContain(`stale since ${goodPoll}`);
			expect(body.fetchedAt).toBe(goodPoll);
			expect(body.error).toBeNull();
			const events = stream.events[Symbol.asyncIterator]();
			const published = await settledOverviewEvent(events, overviewOf);
			stream.close();
			expect(published).toEqual(body);
		});
	});

	test("a failed fetch marks only its own project stale", async () => {
		const requests: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const read = listedRead(input, init);
			if (read !== null && (read.repo === repo || read.repo === otherRepo)) {
				pushListed(requests, read);
				if (read.repo === otherRepo) {
					return new Response("   ", { status: 500 });
				}
				return (
					issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
					page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const fresh = body.projects.find((project) => project.name === repo);
				const stale = body.projects.find(
					(project) => project.name === otherRepo,
				);
				expect(fresh?.tickets).toEqual([githubTicket(1, "backlog")]);
				expect(fresh?.error).toBeNull();
				expect(stale?.error).toContain("HTTP 500");
				expect(stale?.error).toContain(otherRepo);
				expect(stale?.error).not.toContain("stale since");
				expect(body.error).toBeNull();
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				const repeated = await settledOverview(base, readOverview);
				const stillFresh = repeated.projects.find(
					(project) => project.name === repo,
				);
				const stillStale = repeated.projects.find(
					(project) => project.name === otherRepo,
				);
				expect(stillFresh?.error).toBeNull();
				expect(stillStale?.error).toContain("HTTP 500");
				expect(stillStale?.error).not.toContain(repo);
				expect(repeated.error).toBeNull();
			},
			[
				{ tracker: "github", repo },
				{ tracker: "github", repo: otherRepo },
			],
		);
	});

	test("a later pin failure keeps the earlier pin's tickets and since", async () => {
		const requests: string[] = [];
		const failedPins = new Set<string>();
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const read = listedRead(input, init);
			if (read !== null && (read.repo === repo || read.repo === otherRepo)) {
				requests.push(read.url);
				if (read.repo === otherRepo && !failedPins.has(read.repo)) {
					failedPins.add(read.repo);
					return new Response("recorded failure", { status: 500 });
				}
				return (
					issuesResponse(
						input,
						init,
						[ticket(1, "2026-04-01T00:00:00Z")],
						read.repo,
					) ?? page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const failed = await fetch(new URL("/api/overview", base));
				const failedEvent = (await failed.json()) as OverviewBody;
				expect(failedEvent.projects).toEqual([
					counts(repo, 1, 0, "github", [githubTicket(1, "backlog")]),
					counts(
						otherRepo,
						0,
						0,
						"github",
						[],
						null,
						failedEvent.projects[1]?.error ?? null,
					),
				]);
				expect(failedEvent.projects[1]?.error).toContain("HTTP 500");
				expect(failedEvent.projects[1]?.error).toContain(otherRepo);
				expect(failedEvent.error).toBeNull();
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				await settledOverview(base, readOverview);
				const firstLists = requests.filter(
					(url) => listUrl(url, repo) !== null,
				);
				const secondLists = requests.filter(
					(url) => listUrl(url, otherRepo) !== null,
				);
				// One poll shares one repository snapshot, so a start plus a
				// refresh is two reads. The refresh keeps the earlier pin's since.
				expect(firstLists).toHaveLength(2);
				expect(secondLists).toHaveLength(2);
				expect(
					new URL(firstLists[0] ?? "").searchParams.get("since"),
				).toBeNull();
				expect(new URL(firstLists[1] ?? "").searchParams.get("since")).toBe(
					githubSince(goodPoll),
				);
				expect(
					new URL(secondLists[0] ?? "").searchParams.get("since"),
				).toBeNull();
				expect(
					new URL(secondLists[1] ?? "").searchParams.get("since"),
				).toBeNull();
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects).toEqual([
					counts(
						repo,
						1,
						0,
						"github",
						[githubTicket(1, "backlog")],
						"2026-04-01T12:00:01.000Z",
					),
					counts(
						otherRepo,
						1,
						0,
						"github",
						[
							{
								key: `${otherRepo}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-04-01T00:00:00Z",
								updatedAt: "2026-04-01T00:00:00Z",
							},
						],
						"2026-04-01T12:00:01.000Z",
					),
				]);
				expect(body.error).toBeNull();
				expect(body.fetchedAt).toBe("2026-04-01T12:00:01.000Z");
			},
			[
				{ tracker: "github", repo },
				{ tracker: "github", repo: otherRepo },
			],
		);
	});

	test("a poll after a failed fetch keeps the last good since", async () => {
		const requests: string[] = [];
		let releaseFailure: () => void = () => {};
		const failureHeld = new Promise<void>((resolve) => {
			releaseFailure = resolve;
		});
		try {
			await withServer(
				failingThenRecorded(requests, failureHeld),
				3600,
				async (base) => {
					const failed = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(failed.status).toBe(204);
					while (requests.length < 2) {
						await Bun.sleep(20);
					}
					expect(requests.filter((url) => listUrl(url) !== null).length).toBe(
						2,
					);
					releaseFailure();
					const again = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(again.status).toBe(204);
					const body = await settledOverview(base, readOverview);
					const lists = requests.filter((url) => listUrl(url) !== null);
					expect(lists.length).toBeGreaterThan(1);
					expect(new URL(lists.at(-1) ?? "").searchParams.get("since")).toBe(
						githubSince(goodPoll),
					);
					expect(body.fetchedAt).toBe("2026-04-01T12:00:02.000Z");
					expect(body.error).toBeNull();
				},
			);
		} finally {
			releaseFailure();
		}
	});

	test("a poll at the interval requests items updated since the last good poll", async () => {
		const requests: string[] = [];
		await withServer(
			unchangedFetch(requests, [ticket(1, "2026-04-01T00:00:00Z")]),
			1,
			async () => {
				while (requests.filter((url) => listUrl(url) !== null).length < 2) {
					await Bun.sleep(50);
				}
				const lists = requests.filter((url) => listUrl(url) !== null);
				expect(lists.length).toBeGreaterThan(1);
				expect(new URL(lists.at(-1) ?? "").searchParams.get("since")).toBe(
					githubSince(goodPoll),
				);
			},
		);
	});

	test("an incremental poll requests only items updated since the last good poll", async () => {
		const requests: string[] = [];
		await withServer(changingFetch(requests), 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			await settledOverview(base, readOverview);
			const lists = requests.filter((url) => listUrl(url) !== null);
			expect(lists.length).toBeGreaterThan(1);
			expect(new URL(lists[0] ?? "").searchParams.get("since")).toBeNull();
			expect(new URL(lists.at(-1) ?? "").searchParams.get("since")).toBe(
				githubSince(goodPoll),
			);
		});
	});

	test("a recorded tracker change reaches a subscriber after one poll", async () => {
		const requests: string[] = [];
		await withServer(changingFetch(requests), 3600, async (base) => {
			const stream = openEventStream(base);
			await stream.ready;
			const before = await fetch(new URL("/api/overview", base));
			const beforeBody = (await before.json()) as OverviewBody;
			expect(beforeBody.projects).toEqual([
				counts(repo, 1, 0, "github", [githubTicket(1, "backlog")]),
			]);
			expect(beforeBody.fetchedAt).toBe(goodPoll);
			expect(beforeBody.error).toBeNull();
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const eventBody = await settledOverview(base, readOverview);
			expect(eventBody.projects).toEqual([
				counts(
					repo,
					1,
					1,
					"github",
					[
						githubTicket(
							1,
							"done",
							"2026-04-02T00:00:00Z",
							"2026-04-02T00:00:00Z",
						),
						githubTicket(
							2,
							"backlog",
							"2026-04-02T00:00:00Z",
							"2026-04-02T00:00:00Z",
						),
					],
					"2026-04-01T12:00:01.000Z",
				),
			]);
			expect(eventBody.fetchedAt).toBe("2026-04-01T12:00:01.000Z");
			expect(eventBody.error).toBeNull();
			const events = stream.events[Symbol.asyncIterator]();
			const published = await settledOverviewEvent(events, overviewOf);
			stream.close();
			expect(published).toEqual(eventBody);
		});
	});

	test("a poll that changes a ticket updates the project page, and a poll that changes nothing keeps it", async () => {
		const requests: string[] = [];
		await withServer(changingFetch(requests), 3600, async (base) => {
			const projectPage = async () => {
				const response = await fetch(
					new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
				);
				expect(response.status).toBe(200);
				return (await response.json()) as Record<string, unknown>;
			};
			const poll = async () => {
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await settledOverview(base, readOverview);
			};
			const shown = (body: Record<string, unknown>) =>
				(body.tickets as ShownTicket[]).map(({ key, state }) => ({
					key,
					state,
				}));
			const before = await projectPage();
			expect(shown(before)).toEqual([{ key: `${repo}#1`, state: "backlog" }]);
			await poll();
			const changed = await projectPage();
			expect(shown(changed)).toEqual([
				{ key: `${repo}#1`, state: "done" },
				{ key: `${repo}#2`, state: "backlog" },
			]);
			await poll();
			expect(await projectPage()).toEqual(changed);
		});
	});

	test("a failed project with no stored rows gets its own empty card", async () => {
		const requests: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const read = listedRead(input, init);
			if (read !== null && (read.repo === repo || read.repo === otherRepo)) {
				pushListed(requests, read);
				if (read.repo === otherRepo) {
					return new Response("recorded failure", { status: 500 });
				}
				return (
					issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
					page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects.map((project) => project.name)).toEqual([
					repo,
					otherRepo,
				]);
				expect(body.projects[1]?.tickets).toEqual([]);
				expect(body.projects[1]?.error).toContain("HTTP 500");
				expect(body.projects[1]?.error).toContain(otherRepo);
				expect(body.error).toBeNull();
			},
			[
				{ tracker: "github", repo },
				{ tracker: "github", repo: otherRepo },
			],
		);
	});

	test("a GitHub progress comment edited in place reaches the next incremental poll", async () => {
		const requests: string[] = [];
		const issueUpdatedAt = "2026-04-01T08:00:00.000Z";
		const issue = {
			number: 192,
			title: "Live run",
			state: "open",
			state_reason: null,
			updated_at: issueUpdatedAt,
			created_at: "2026-04-01T07:00:00.000Z",
			html_url: `https://github.com/${repo}/issues/192`,
			comments: 1,
			body: "",
		};
		const storedCommentAt = "2026-04-01T10:04:00.000Z";
		const commentNode = (body: string, updatedAt: string) => ({
			databaseId: recordedProgressComment.id,
			body,
			createdAt: recordedProgressComment.created_at,
			updatedAt,
			author: { login: recordedProgressComment.user.login },
			reactions: { totalCount: 0 },
		});
		const recorded = {
			...recordedProgressComment,
			issue_url: `https://api.github.com/repos/${repo}/issues/192`,
			html_url: `https://github.com/${repo}/issues/192#issuecomment-${recordedProgressComment.id}`,
			updated_at: storedCommentAt,
		};
		const edited = {
			...recorded,
			issue_url: `https://api.github.com/repos/${repo.toUpperCase()}/issues/192`,
			body: `${recorded.body}\n- stage 4: implementing`,
			updated_at: "2026-04-01T12:05:10.000Z",
		};
		let commentReads = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			const read = listedRead(input, init);
			if (read !== null) {
				pushListed(requests, read);
				const node = githubIssueNode({
					...issue,
					commentRows: [
						{
							id: recordedProgressComment.id,
							body: read.since === null ? recorded.body : edited.body,
							created_at: recordedProgressComment.created_at,
							updated_at:
								read.since === null ? storedCommentAt : edited.updated_at,
							user: { login: recordedProgressComment.user.login },
						},
					],
				});
				const comments = {
					nodes: [
						commentNode(
							read.since === null ? recorded.body : edited.body,
							read.since === null ? storedCommentAt : edited.updated_at,
						),
					],
					pageInfo: { hasNextPage: false, endCursor: null },
				};
				node.comments = comments;
				const [owner, name] = read.repo.split("/");
				return new Response(
					JSON.stringify(
						repoReadIssues(
							owner ?? "acme",
							name ?? "widget",
							[node],
							read.since === null ? {} : { edited: [node] },
						),
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			requests.push(url);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === `https://api.github.com/repos/${repo}`) {
				return Response.json({ allow_auto_merge: false });
			}
			if (url === `https://api.github.com/repos/${repo}/issues/192`) {
				return Response.json(issue);
			}
			if (url.includes("/issues/192/comments")) {
				commentReads += 1;
				return page([commentReads === 1 ? recorded : edited]);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(fetchImpl, 3600, async (base, advance) => {
			const firstOverview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as OverviewBody;
			const first = (await (
				await fetch(new URL(`/api/projects/${encodeURIComponent(repo)}`, base))
			).json()) as { tickets: ShownTicket[] };
			expect(first.tickets[0]).toMatchObject({
				key: `${repo}#192`,
				state: "inProgress",
				run: { status: "running", stage: "stage 2" },
			});
			expect(first.tickets[0]?.chips ?? []).not.toContain("Run failed");
			expect(firstOverview.error).toBeNull();
			advance(5 * 60 * 1000);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = await settledOverview(base, readOverview);
			const report = (await (
				await fetch(new URL(`/api/projects/${encodeURIComponent(repo)}`, base))
			).json()) as { tickets: ShownTicket[] };
			const ticket = report.tickets[0];
			expect(ticket).toMatchObject({
				key: `${repo}#192`,
				state: "inProgress",
				run: { status: "running", stage: "stage 4" },
			});
			expect(ticket?.chips ?? []).not.toContain("Run failed");
			expect(body.projects[0]?.tickets[0]?.state).toBe("inProgress");
			const needsYou = (await (
				await fetch(new URL("/api/needs-you", base))
			).json()) as { key: string; reason: string }[];
			expect(needsYou.filter((row) => row.key === `${repo}#192`)).toEqual([]);
			expect(body.error).toBeNull();
			const lists = requests.filter((item) => listUrl(item) !== null);
			expect(lists).toHaveLength(2);
			expect(new URL(lists[1] ?? "").searchParams.get("since")).toBe(
				githubSince(goodPoll),
			);
			expect(
				requests.some(
					(item) =>
						item.includes("query RepoRead") || item.includes("/issues?"),
				),
			).toBe(true);
		});
	});

	test("an edited comment with a blank issue link leaves the stored ticket", async () => {
		const requests: string[] = [];
		let polls = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const blank = listedRead(input, init);
			if (blank !== null && blank.repo === repo) {
				requests.push(blank.url);
				polls += 1;
				return (
					issuesResponse(
						input,
						init,
						polls === 1 ? [ticket(1, "2026-04-01T00:00:00Z")] : [],
					) ?? page([])
				);
			}
			if (url.includes(`/repos/${repo}/issues/comments?`)) {
				requests.push(url);
				return page([
					{
						id: 1,
						issue_url: "   ",
						body: "   ",
						updated_at: "2026-04-01T12:05:00.000Z",
					},
					{
						id: 2,
						issue_url: `https://api.github.com/repos/${otherRepo}/issues/9`,
						body: "edited elsewhere",
						updated_at: "2026-04-01T12:05:00.000Z",
					},
				]);
			}
			if (/\/repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(url)) {
				requests.push(url);
				return new Response("recorded failure", { status: 500 });
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(fetchImpl, 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = await settledOverview(base, readOverview);
			expect(body.projects[0]?.tickets).toEqual([githubTicket(1, "backlog")]);
			expect(body.error).toBeNull();
			expect(requests.filter((url) => /\/issues\/\d+$/.test(url))).toEqual([]);
		});
	});

	test("a missing edited issue leaves the stored tickets", async () => {
		const requests: string[] = [];
		let polls = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const missing = listedRead(input, init);
			if (missing !== null && missing.repo === repo) {
				requests.push(missing.url);
				polls += 1;
				return (
					issuesResponse(
						input,
						init,
						polls === 1 ? [ticket(1, "2026-04-01T00:00:00Z")] : [],
					) ?? page([])
				);
			}
			if (url.includes(`/repos/${repo}/issues/comments?`)) {
				return page([
					{
						id: 3,
						issue_url: `https://api.github.com/repos/${repo}/issues/404`,
						body: "**Workcell progress**\n\n- stage 4: implementing",
						updated_at: "2026-04-01T12:05:00.000Z",
						user: { login: "lev" },
					},
				]);
			}
			if (url === `https://api.github.com/repos/${repo}/issues/404`) {
				requests.push(url);
				return new Response("not found", { status: 404 });
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(fetchImpl, 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = await settledOverview(base, readOverview);
			expect(body.projects[0]?.tickets.map((item) => item.key)).toEqual([
				`${repo}#1`,
			]);
			expect(body.error).toBeNull();
			expect(
				requests.filter((url) => listUrl(url) !== null).length,
			).toBeGreaterThan(0);
			expect(
				requests.filter((url) => url.endsWith("/issues/404")),
			).toHaveLength(0);
		});
	});
});
