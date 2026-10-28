import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { linearFake } from "../support/linear.ts";
import {
	ask,
	bodyOf,
	inboxOf,
	isIssueQuery,
	linearIssue,
	linearProject,
	notificationAfterRefresh,
	pinned,
	recordedIssues,
	refresh,
	withInbox,
} from "./_support.ts";

describe("inbox", () => {
	test("a new comment on a needs-you ticket produces an event and an inbox entry", async () => {
		const headline = "Which bot should review this?";
		const first = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[
				{
					body: `${headline}\n\n${ask("pf-1")}`,
					createdAt: "2026-08-18T12:00:00.000Z",
				},
			],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [first], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{
							body: "A later note on the same ask.",
							createdAt: "2026-08-18T14:00:00.000Z",
						},
					],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			const event = await notificationAfterRefresh(base);
			expect(event).toMatchObject({
				trigger: "comment",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("a blank comment and a repeated poll add no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[
				{
					body: `${headline}\n\n${ask("pf-1")}`,
					createdAt: "2026-08-18T12:00:00.000Z",
				},
			],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [issue], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{ body: "   ", createdAt: "2026-08-18T14:00:00.000Z" },
					],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
		});
	});

	test("a blank stamp, an older comment and a same-time comment add no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const note = {
			body: "A later note on the same ask.",
			createdAt: "2026-08-18T14:00:00.000Z",
		};
		await withInbox(
			pinned,
			[linearIssue("PF-1", "Open ask", headline, [askComment, note])],
			async (base, setIssues) => {
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					linearIssue("PF-1", "Open ask", headline, [
						askComment,
						{ body: "   ", createdAt: "   " },
						{ body: "No time.", createdAt: "" },
						{
							body: "An older note.",
							createdAt: "2026-08-18T13:00:00.000Z",
						},
					]),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					linearIssue("PF-1", "Open ask", headline, [
						askComment,
						{ ...note, body: "Same time, new words." },
					]),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
			},
		);
	});

	test("editing or deleting a comment adds no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const note = {
			body: "A later note on the same ask.",
			createdAt: "2026-08-18T14:00:00.000Z",
		};
		await withInbox(
			pinned,
			[linearIssue("PF-1", "Open ask", headline, [askComment, note])],
			async (base, setIssues) => {
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					linearIssue("PF-1", "Open ask", headline, [
						askComment,
						{ ...note, body: "A later note, edited." },
					]),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				setIssues([linearIssue("PF-1", "Open ask", headline, [askComment])]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
			},
		);
	});

	test("a reply that answers the open ask adds no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[
				{
					body: `${headline}\n\n${ask("pf-1")}`,
					createdAt: "2026-08-18T12:00:00.000Z",
				},
			],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [issue], async (base, setIssues) => {
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{
							body: "Reply: use the review bot.",
							createdAt: "2026-08-18T14:00:00.000Z",
							user: { name: "AbysmalBiscuit" },
						},
					],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
		});
	});

	test("an agent comment after Lev's reply produces an inbox entry", async () => {
		const headline = "Which bot should review this?";
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[
				{
					body: `${headline}\n\n${ask("pf-1")}`,
					createdAt: "2026-08-18T12:00:00.000Z",
				},
			],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [issue], async (base, setIssues) => {
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{
							body: "Reply: use the review bot.",
							createdAt: "2026-08-18T14:00:00.000Z",
							user: { name: "AbysmalBiscuit" },
						},
					],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{
							body: "Reply: use the review bot.",
							createdAt: "2026-08-18T14:00:00.000Z",
							user: { name: "AbysmalBiscuit" },
						},
						{
							body: "The review bot is running.",
							createdAt: "2026-08-18T15:00:00.000Z",
							user: { name: "workcell" },
						},
					],
					{},
					"2026-08-18T15:00:00.000Z",
				),
			]);
			const event = await notificationAfterRefresh(base);
			expect(event).toMatchObject({
				trigger: "comment",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("a disabled comment trigger leaves a new comment out of the inbox", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const note = {
			body: "A later note.",
			createdAt: "2026-08-18T14:00:00.000Z",
		};
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[askComment],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		const commented = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[askComment, note],
			{},
			"2026-08-18T14:00:00.000Z",
		);
		await withInbox(
			{
				...pinned,
				notificationTriggers: {
					needsYou: true,
					comment: false,
					blockerCleared: true,
				},
			},
			[issue],
			async (base, setIssues) => {
				setIssues([commented]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
			},
		);
		await withInbox(pinned, [issue], async (base, setIssues) => {
			setIssues([commented]);
			const event = await notificationAfterRefresh(base);
			expect(event).toMatchObject({
				trigger: "comment",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("a comment by the viewer adds no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const viewerName = `viewer-${crypto.randomUUID()}`;
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
			user: { name: "Ada Lovelace" },
		};
		const viewerNote = {
			body: "A later note from the viewer.",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "Not A Login", displayName: viewerName },
		};
		const otherNote = {
			body: "A later note from someone else.",
			createdAt: "2026-08-18T15:00:00.000Z",
			user: { name: "Ada Lovelace" },
		};
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				return recordedIssues(current);
			}
			const response = await recorded(input, init);
			if (!bodyOf(init).includes("viewer")) {
				return response;
			}
			const page = (await response.json()) as {
				data?: { viewer?: { id?: string } };
			};
			if (page.data?.viewer !== undefined) {
				page.data.viewer.id = viewerName;
			}
			return Response.json(page);
		};
		let current = [linearIssue("PF-1", "Open ask", headline, [askComment])];
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const done = new Promise<void>((resolve, reject) => {
			startChecks = (base) => {
				void (async () => {
					expect(viewerName).not.toBe("viewer-ada");
					expect(await inboxOf(base)).toEqual([]);
					current = [
						linearIssue("PF-1", "Open ask", headline, [
							askComment,
							{
								body: "A note with a blank author.",
								createdAt: "2026-08-18T13:30:00.000Z",
								user: { name: "   ", displayName: "" },
							},
							{
								body: "   ",
								createdAt: "2026-08-18T13:00:00.000Z",
								user: { name: "   ", displayName: "   " },
							},
							viewerNote,
						]),
					];
					await refresh(base);
					expect(await inboxOf(base)).toEqual([]);
					current = [
						linearIssue(
							"PF-1",
							"Open ask",
							headline,
							[askComment, viewerNote, otherNote],
							{},
							"2026-08-18T15:00:00.000Z",
						),
					];
					const event = await notificationAfterRefresh(base);
					expect(event).toMatchObject({
						trigger: "comment",
						project: "Project Flow",
						key: "PF-1",
						text: headline,
					});
					expect(await inboxOf(base)).toEqual([event]);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: done,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank reply, a repeated-space reply and a failing comment page add no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[askComment],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [issue], async (base, setIssues, failComments) => {
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, { body: "", createdAt: "2026-08-18T14:00:00.000Z" }],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						askComment,
						{ body: "Reply:   ", createdAt: "2026-08-18T15:00:00.000Z" },
					],
					{},
					"2026-08-18T15:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			failComments(true);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
		});
	});

	test("a refresh during the first poll stores the reply that arrived while the issue read was held", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		let current = [
			linearIssue(
				"PF-1",
				"Open ask",
				headline,
				[askComment],
				{},
				"2026-08-18T12:00:00.000Z",
			),
		];
		const recorded = linearFake({ project: linearProject });
		let releaseIssues = () => {};
		const issuesHeld = new Promise<void>((resolve) => {
			releaseIssues = resolve;
		});
		let enteredHold: () => void = () => {};
		const holding = new Promise<void>((resolve) => {
			enteredHold = resolve;
		});
		let issueReads = 0;
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				issueReads += 1;
				const seen = current;
				if (issueReads === 1) {
					enteredHold();
					await issuesHeld;
				}
				return recordedIssues(seen);
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		let stop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		let ready: (base: string) => void = () => {};
		const listening = new Promise<string>((resolve) => {
			ready = resolve;
		});
		const started = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo(
				{
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					stdout: ready,
					waitForStop: stopped,
				},
				{ first: true },
			),
		);
		try {
			const base = await listening;
			await holding;
			expect(await inboxOf(base)).toEqual([]);
			current = [
				linearIssue(
					"PF-1",
					"Review bot chosen",
					headline,
					[askComment, reply],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			];
			const refreshing = fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			releaseIssues();
			const refreshed = await refreshing;
			expect(refreshed.status).toBe(204);
			let report: { tickets: { key: string | null; title: string }[] } = {
				tickets: [],
			};
			while (report.tickets[0]?.title !== "Review bot chosen") {
				const project = await fetch(
					new URL("/api/projects/Project%20Flow?view=all", base),
				);
				expect(project.status).toBe(200);
				report = (await project.json()) as typeof report;
				if (report.tickets[0]?.title !== "Review bot chosen") {
					await Bun.sleep(20);
				}
			}
			expect(report.tickets).toEqual([
				expect.objectContaining({
					key: "PF-1",
					title: "Review bot chosen",
				}),
			]);
			const listed = await fetch(new URL("/api/needs-you", base));
			expect(listed.status).toBe(200);
			expect(await listed.json()).toEqual([
				expect.objectContaining({
					key: "PF-1",
					reason: "ask",
					headline,
					answered: true,
				}),
			]);
		} finally {
			stop();
			await started;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
