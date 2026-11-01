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
	pullUrl,
	repo,
	sendMerge,
	widgetConfig,
} from "./_support.ts";

const openQuestionBody = `Closes #8

### Important Questions

<details><summary><b>1. redefines the scope:</b> Should the widget ship?</summary>

The widget changes its scope.

</details>
`;

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

	test("the row of an awaiting PR lists its actions and an open gate", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const row = (await needsYou(base)).find(
				(item) => item.key === `${repo}#8`,
			);
			expect(row?.reason).toBe("awaitingMerge");
			expect(row?.awaitingPulls).toEqual([
				expect.objectContaining({
					url: pullUrl,
					actions: ["merge", "requestChanges"],
					mergeGate: { open: true },
				}),
			]);
		});
	});

	test("a Decide row lists Request changes and the closed gate, but no merge action", async () => {
		const fake = mergeFake({ body: openQuestionBody });
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const row = (await needsYou(base)).find(
				(item) => item.key === `${repo}#8`,
			);
			expect(row?.reason).toBe("decide");
			expect(row?.awaitingPulls).toEqual([
				expect.objectContaining({
					url: pullUrl,
					actions: ["requestChanges"],
					mergeGate: { open: false, reason: "An Important Question is open" },
				}),
			]);
		});
	});

	test("a merge from the row takes the row out of the next Needs you response", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const row = (await needsYou(base)).find(
				(item) => item.key === `${repo}#8`,
			);
			const url = row?.awaitingPulls?.[0]?.url;
			expect(url).toBe(pullUrl);
			expect((await sendMerge(base, url)).status).toBe(204);
			expect(fake.merges).toHaveLength(1);
			expect(
				(await needsYou(base)).find((item) => item.key === `${repo}#8`),
			).toBeUndefined();
		});
	});

	test("a PR with a pending check has no Merge row", async () => {
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
			expect(row?.reason).not.toBe("awaitingMerge");
			expect(row?.awaitingPulls).toBeUndefined();
		});
	});
});
