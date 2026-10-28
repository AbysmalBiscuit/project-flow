import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";
import {
	ask,
	bodyOf,
	expectQuietRefresh,
	inboxOf,
	isIssueQuery,
	isPinQuery,
	linearIssue,
	linearProject,
	notificationAfterRefresh,
	pinned,
	quietUntil,
	recordedIssues,
	refresh,
	withInbox,
} from "./_support.ts";

describe("inbox", () => {
	test("a new needs-you item produces an event and an inbox entry", async () => {
		const headline = "Which bot should review this?";
		await withInbox(pinned, [], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[{ body: `${headline}\n\n${ask("pf-1")}` }],
					{},
					"2026-08-18T13:00:00.000Z",
				),
			]);
			const event = await notificationAfterRefresh(base);
			expect(event).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("a disabled trigger produces no event and no inbox entry", async () => {
		const headline = "Which bot should review this?";
		await withInbox(
			{
				...pinned,
				notificationTriggers: {
					needsYou: false,
					comment: true,
					blockerCleared: true,
				},
			},
			[],
			async (base, setIssues) => {
				setIssues([
					linearIssue(
						"PF-1",
						"Open ask",
						headline,
						[{ body: `${headline}\n\n${ask("pf-1")}` }],
						{},
						"2026-08-18T13:00:00.000Z",
					),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				const needs = await (
					await fetch(new URL("/api/needs-you", base))
				).json();
				expect(needs).toHaveLength(1);
			},
		);
	});

	test("a ticket that leaves needs-you and joins again raises a notification", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.\n\npf-1",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		const open = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[askComment],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [open], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			const listed = await fetch(new URL("/api/needs-you", base));
			expect(listed.status).toBe(200);
			expect(await listed.json()).toEqual([]);
			const again = {
				body: `${headline}\n\n${ask("pf-2")}`,
				createdAt: "2026-08-18T16:00:00.000Z",
			};
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply, again],
					{},
					"2026-08-18T16:00:00.000Z",
				),
			]);
			const event = await notificationAfterRefresh(base);
			expect(event).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
			const rejoined = await fetch(new URL("/api/needs-you", base));
			expect(rejoined.status).toBe(200);
			expect(await rejoined.json()).toEqual([
				expect.objectContaining({
					key: "PF-1",
					reason: "ask",
					headline,
				}),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("a ticket that stays in needs-you raises no second notification", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		await withInbox(
			pinned,
			[
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment],
					{},
					"2026-08-18T12:00:00.000Z",
				),
			],
			async (base, setIssues) => {
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					linearIssue(
						"PF-1",
						"Open ask",
						headline,
						[
							askComment,
							{
								body: "Still waiting.",
								createdAt: "2026-08-18T13:00:00.000Z",
							},
						],
						{},
						"2026-08-18T13:00:00.000Z",
					),
				]);
				await refresh(base);
				const first = await inboxOf(base);
				expect(first).toHaveLength(1);
				expect(first[0]).toMatchObject({ trigger: "comment", key: "PF-1" });
				await refresh(base);
				expect(await inboxOf(base)).toEqual(first);
			},
		);
	});

	test("a ticket whose key changes case between polls raises one notification", async () => {
		const headline = "Which bot should review this?";
		const askedAs = (identifier: string) =>
			linearIssue(
				identifier,
				"Open ask",
				headline,
				[
					{
						body: `${headline}\n\n${ask("pf-1")}`,
						createdAt: "2026-08-18T12:00:00.000Z",
					},
				],
				{},
				"2026-08-18T13:00:00.000Z",
			);
		await withInbox(pinned, [], async (base, setIssues) => {
			setIssues([askedAs("PF-1")]);
			const event = await notificationAfterRefresh(base);
			expect(event).toMatchObject({ trigger: "needsYou", key: "PF-1" });
			setIssues([askedAs("pf-1")]);
			await expectQuietRefresh(base);
			setIssues([askedAs("PF-1")]);
			await expectQuietRefresh(base);
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("an incremental poll keeps one ticket when its key changes case", async () => {
		const named = (identifier: string) =>
			linearIssue(identifier, "Open ticket", "");
		await withInbox(pinned, [named("PF-1")], async (base, setIssues) => {
			await refresh(base);
			setIssues([named("pf-1")]);
			await refresh(base);
			const response = await fetch(
				new URL(
					`/api/projects/${encodeURIComponent(linearProject.name)}?view=all`,
					base,
				),
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				tickets: { key: string }[];
			};
			expect(body.tickets.map((ticket) => ticket.key)).toEqual(["pf-1"]);
		});
	});

	test("an idle project that shows again raises no second notification, and a leave and rejoin on a loaded project does", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-06-01T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.\n\npf-1",
			createdAt: "2026-06-01T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		const again = {
			body: `${headline}\n\n${ask("pf-2")}`,
			createdAt: "2026-06-01T16:00:00.000Z",
		};
		const idle = {
			id: "project-idle",
			name: "Idle",
			slugId: "idle",
			updatedAt: "2026-06-01T12:00:00.000Z",
		};
		const loaded = {
			id: "project-loaded",
			name: "Loaded",
			slugId: "loaded",
			updatedAt: "2026-10-18T12:00:00.000Z",
		};
		const openOn = (
			project: typeof idle,
			identifier: string,
			comments: {
				body: string;
				createdAt?: string;
				user?: { name: string };
			}[],
			updatedAt: string,
		) => ({
			...linearIssue(identifier, "Open ask", headline, comments, {}, updatedAt),
			projectId: project.id,
		});
		let current = [
			openOn(idle, "IDLE-1", [askComment], "2026-06-01T12:00:00.000Z"),
			openOn(loaded, "LOAD-1", [askComment], "2026-10-18T12:00:00.000Z"),
		];
		const recorded = linearFake({ project: null });
		const fetchImpl: Fetch = async (input, init) => {
			if (
				urlOf(input) === "https://api.linear.app/graphql" &&
				bodyOf(init).includes("MemberProjects")
			) {
				return Response.json({
					data: {
						viewer: { id: "viewer-ada" },
						projects: {
							nodes: [idle, loaded],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				});
			}
			if (isIssueQuery(input, init)) {
				const projectId = bodyOf(init).match(
					/"project":\{"id":\{"eq":"([^"]+)"/,
				)?.[1];
				return recordedIssues(
					current.filter((issue) => issue.projectId === projectId),
				);
			}
			if (isPinQuery(input, init)) {
				const slug = bodyOf(init).match(/"pin":"([^"]+)"/)?.[1];
				const project =
					[idle, loaded].find((item) => item.slugId === slug) ?? null;
				return Response.json({
					data: { projects: { nodes: project === null ? [] : [project] } },
				});
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "linear", project: "idle" },
					{ tracker: "linear", project: "loaded" },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			let stop: () => void = () => {};
			const stopped = new Promise<void>((resolve) => {
				stop = resolve;
			});
			let ready: (base: string) => void = () => {};
			const started = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => ready(line),
					waitForStop: stopped,
				}),
			);
			const base = await started;
			expect(await inboxOf(base)).toEqual([]);
			const listed = await fetch(new URL("/api/needs-you", base));
			expect(listed.status).toBe(200);
			expect(await listed.json()).toEqual([
				expect.objectContaining({ project: "Idle", key: "IDLE-1" }),
				expect.objectContaining({ project: "Loaded", key: "LOAD-1" }),
			]);
			const shownConfig = {
				tracked: [
					{ tracker: "linear", project: "idle" },
					{ tracker: "linear", project: "loaded" },
				],
				pollIntervalSeconds: 3600,
				checkoutRoots: [],
			};
			const untrackedConfig = {
				...shownConfig,
				tracked: [{ tracker: "linear", project: "loaded" }],
			};
			await Bun.write(path, JSON.stringify(untrackedConfig));
			await refresh(base);
			const hiddenList = await fetch(new URL("/api/needs-you", base));
			expect(hiddenList.status).toBe(200);
			expect(await hiddenList.json()).toEqual([
				expect.objectContaining({ project: "Loaded", key: "LOAD-1" }),
			]);
			expect(await inboxOf(base)).toEqual([]);
			stop();
			await running;
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let againReady: (base: string) => void = () => {};
			const second = new Promise<string>((resolve) => {
				againReady = resolve;
			});
			const restarted = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => againReady(line),
					waitForStop: secondStop,
				}),
			);
			const next = await second;
			const hiddenAgain = await fetch(new URL("/api/needs-you", next));
			expect(hiddenAgain.status).toBe(200);
			expect(await hiddenAgain.json()).toEqual([
				expect.objectContaining({ project: "Loaded", key: "LOAD-1" }),
			]);
			await Bun.write(path, JSON.stringify(shownConfig));
			await quietUntil(next, async () => {
				const listed = await fetch(new URL("/api/needs-you", next));
				expect(listed.status).toBe(200);
				const items = (await listed.json()) as { project: string }[];
				return items.some((item) => item.project === "Idle");
			});
			expect(await inboxOf(next)).toEqual([]);
			await refresh(next);
			const shownList = await fetch(new URL("/api/needs-you", next));
			expect(shownList.status).toBe(200);
			expect(await shownList.json()).toEqual([
				expect.objectContaining({ project: "Idle", key: "IDLE-1" }),
				expect.objectContaining({ project: "Loaded", key: "LOAD-1" }),
			]);
			current = [
				openOn(idle, "IDLE-1", [askComment], "2026-06-01T12:00:00.000Z"),
				openOn(
					loaded,
					"LOAD-1",
					[askComment, reply],
					"2026-10-18T14:00:00.000Z",
				),
			];
			await refresh(next);
			expect(await inboxOf(next)).toEqual([]);
			current = [
				openOn(idle, "IDLE-1", [askComment], "2026-06-01T12:00:00.000Z"),
				openOn(
					loaded,
					"LOAD-1",
					[askComment, reply, again],
					"2026-10-18T16:00:00.000Z",
				),
			];
			const event = await notificationAfterRefresh(next);
			expect(event).toMatchObject({
				trigger: "needsYou",
				project: "Loaded",
				key: "LOAD-1",
				text: headline,
			});
			expect(await inboxOf(next)).toEqual([event]);
			stopSecond();
			await restarted;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test("a ticket that joins, leaves and joins again raises two needs-you notifications", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.\n\npf-1",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		const again = {
			body: `${headline}\n\n${ask("pf-2")}`,
			createdAt: "2026-08-18T16:00:00.000Z",
		};
		await withInbox(pinned, [], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment],
					{},
					"2026-08-18T12:00:00.000Z",
				),
			]);
			const first = await notificationAfterRefresh(base);
			expect(first).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([first]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply, again],
					{},
					"2026-08-18T16:00:00.000Z",
				),
			]);
			const second = await notificationAfterRefresh(base);
			expect(second).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(second.id).not.toBe(first.id);
			expect(await inboxOf(base)).toEqual([second, first]);
		});
	});
});
