import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	devkitWorktree,
	linearIssue,
	linearSlug,
	type NeedsYouItem,
	needsYouOf,
	progress,
	projectOf,
	recordedLinear,
	ticketOf,
	todoState,
	withApp,
} from "./_support.ts";

async function fakeHerdr(
	script: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	const path = await mkdtemp(join(tmpdir(), "project-flow-herdr-"));
	const herdr = join(path, "herdr");
	await writeFile(herdr, script);
	await chmod(herdr, 0o755);
	return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

describe("forward state", () => {
	test("a herdr list that exits nonzero does not stall an open run", async () => {
		const checkout = await devkitWorktree({
			key: "WID-12",
			status: "running",
			manager: "manager-144-unread",
		});
		const herdr = await fakeHerdr("#!/bin/sh\nexit 1\n");
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-12", "Ship the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 1: implementing"),
									createdAt: "2026-08-18T13:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					}),
				]),
				{
					LINEAR_API_KEY: "recorded-linear-key",
					PATH: `${herdr.path}:${process.env.PATH ?? ""}`,
				},
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-12")).toMatchObject({
						state: "inProgress",
						status: "In Progress",
					});
					expect(ticketOf(report, "WID-12").chips ?? []).not.toContain(
						"Run failed",
					);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
			await herdr.cleanup();
		}
	});

	test("malformed herdr output does not stall an open run", async () => {
		const checkout = await devkitWorktree({
			key: "WID-13",
			status: "running",
			manager: "manager-144-unread",
		});
		const herdr = await fakeHerdr(`#!/usr/bin/env bun
console.log("not json {");
`);
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([linearIssue("WID-13", "Ship the list", todoState)]),
				{
					LINEAR_API_KEY: "recorded-linear-key",
					PATH: `${herdr.path}:${process.env.PATH ?? ""}`,
				},
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-13")).toMatchObject({
						state: "inProgress",
						status: "In Progress",
					});
					expect(ticketOf(report, "WID-13").chips ?? []).not.toContain(
						"Run failed",
					);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
			await herdr.cleanup();
		}
	});

	test("a starting run whose manager agent is gone is stalled in needs-you", async () => {
		const checkout = await devkitWorktree({
			key: "WID-13",
			status: "starting",
			manager: "manager-144-starting",
		});
		const herdr = await fakeHerdr(
			`#!/usr/bin/env bun
console.log(JSON.stringify({ result: { agents: [] } }));
`,
		);
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([linearIssue("WID-13", "Ship the list", todoState)]),
				{
					LINEAR_API_KEY: "recorded-linear-key",
					PATH: `${herdr.path}:${process.env.PATH ?? ""}`,
				},
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-13")).toMatchObject({
						state: "backlog",
						status: "Todo",
						chips: ["Run failed"],
					});
					const needs = await fetch(new URL("/api/needs-you", base));
					expect(needs.status).toBe(200);
					const items = (await needs.json()) as NeedsYouItem[];
					expect(
						items
							.filter((row) => row.key === "WID-13")
							.map((row) => row.reason),
					).toEqual(["runFailed"]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
			await herdr.cleanup();
		}
	});

	test("an open run whose manager agent is gone is stalled in needs-you", async () => {
		const checkout = await devkitWorktree({
			key: "WID-9",
			status: "running",
			manager: "manager-144-gone",
		});
		const herdr = await fakeHerdr(
			`#!/usr/bin/env bun
const agents = process.env.HERDR_AGENTS ?? "[]";
console.log(JSON.stringify({ result: { agents: JSON.parse(agents) } }));
`,
		);
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-9", "Ship the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 1: implementing"),
									createdAt: "2026-08-18T13:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					}),
				]),
				{
					LINEAR_API_KEY: "recorded-linear-key",
					PATH: `${herdr.path}:${process.env.PATH ?? ""}`,
					HERDR_AGENTS: "[]",
				},
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-9")).toMatchObject({
						state: "backlog",
						status: "Todo",
						chips: ["Run failed"],
					});
					const needs = await fetch(new URL("/api/needs-you", base));
					expect(needs.status).toBe(200);
					const items = (await needs.json()) as NeedsYouItem[];
					expect(
						items.filter((row) => row.key === "WID-9").map((row) => row.reason),
					).toEqual(["runFailed"]);
					expect(
						needsYouOf(report)
							.filter((row) => row.key === "WID-9")
							.map((row) => row.reason),
					).toEqual(["runFailed"]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
			await herdr.cleanup();
		}
	});

	test("an open run whose manager agent is listed stays live", async () => {
		const checkout = await devkitWorktree({
			key: "WID-10",
			status: "running",
			manager: "manager-144-live",
		});
		const herdr = await fakeHerdr(
			`#!/usr/bin/env bun
const agents = process.env.HERDR_AGENTS ?? "[]";
console.log(JSON.stringify({ result: { agents: JSON.parse(agents) } }));
`,
		);
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-10", "Ship the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 1: implementing"),
									createdAt: "2026-08-18T13:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					}),
				]),
				{
					LINEAR_API_KEY: "recorded-linear-key",
					PATH: `${herdr.path}:${process.env.PATH ?? ""}`,
					HERDR_AGENTS: JSON.stringify([{ name: "manager-144-live" }]),
				},
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-10")).toMatchObject({
						state: "inProgress",
						status: "In Progress",
						staleStatus: "Todo",
					});
					expect(ticketOf(report, "WID-10").chips ?? []).not.toContain(
						"Run failed",
					);
					const needs = await fetch(new URL("/api/needs-you", base));
					expect(needs.status).toBe(200);
					const items = (await needs.json()) as NeedsYouItem[];
					expect(items.filter((row) => row.key === "WID-10")).toEqual([]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
			await herdr.cleanup();
		}
	});
});
