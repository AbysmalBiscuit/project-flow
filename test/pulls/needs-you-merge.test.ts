import { describe, expect, test } from "bun:test";

import type { NeedsYouItem } from "../../src/domain.ts";
import { withApp } from "../project-harness.ts";
import {
	githubEnv,
	linearConfig,
	linearEnv,
	linearStatusOnlyFake,
	mergeFake,
	passedCheck,
	repo,
	widgetConfig,
} from "./_support.ts";

const needsYou = async (base: string) =>
	(await (
		await fetch(new URL("/api/needs-you", base))
	).json()) as NeedsYouItem[];

describe("the Merge row of Needs you", () => {
	test("a ticket that only its tracker status moved to Awaiting merge has no Merge row", async () => {
		await withApp(
			linearConfig,
			linearStatusOnlyFake(),
			linearEnv,
			async (base) => {
				expect(await needsYou(base)).toEqual([]);
			},
		);
	});

	test("the row of an awaiting PR carries an open gate", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const row = (await needsYou(base)).find(
				(item) => item.key === `${repo}#8`,
			);
			expect(row?.reason).toBe("awaitingMerge");
			expect(row?.awaitingPulls?.[0]?.mergeGate).toEqual({ open: true });
		});
	});

	test("the row of an awaiting PR with a pending check names the reason", async () => {
		const fake = mergeFake({
			checks: [
				passedCheck,
				{ name: "e2e", status: "queued", conclusion: null },
			],
		});
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const row = (await needsYou(base)).find(
				(item) => item.key === `${repo}#8`,
			);
			expect(row?.awaitingPulls?.[0]?.mergeGate).toEqual({
				open: false,
				reason: "A check is pending",
			});
		});
	});
});
