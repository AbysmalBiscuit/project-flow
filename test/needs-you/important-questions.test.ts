import { describe, expect, test } from "bun:test";

import {
	githubRecorded,
	openIssue,
	openPull,
	readNeedsYou,
} from "./_support.ts";

const openAndRunAnswered = `Closes #8

### Important Questions

<details><summary><b>1. redefines label start scope:</b> Should <code>startedBy</code> end a box label start only at a hub run on that box?</summary>

\`startedBy\` in \`src/run-start.ts\` now ends a box label start at any new hub-source run of the ticket.

</details>

<details><summary><b>2. duplicates box-to-hub mapping:</b> Should <code>startedBy</code> match the run box?</summary>

\`mergedRuns\` in \`src/factory-run-rows.ts\` takes \`sourceFactory\` from the first hub row of the run id.

</details>

### Answers

#### First round

2. duplicates box-to-hub mapping: Should startedBy match the run box? | Verdict: Ask | Answer: No branch change. Why:
   1. The handoff excludes other factories.
   2. The hub row names the factory.

## Proof

1. ✅ Test passes.
`;

const allRunAnswered = `A fix with no ticket.

### Important Questions

<details><summary><b>1. duplicates start request end:</b> Should a label start end by the <code>known</code> run ids?</summary>

\`settledRequests\` in \`src/run-start.ts:118\` ends a claim by run ids.

</details>

### Answers

#### First round

1. duplicates start request end: Should a label start end by the known run ids? | Verdict: Ask | Answer: No branch change. Why: the time comparison stays.

## Proof

1. ✅ Test passes.
`;

describe("needs you", () => {
	test("asks Lev to decide an awaiting PR with an open Important Question", async () => {
		const repo = "acme/widget";
		const { items } = await readNeedsYou(
			githubRecorded(repo, {
				issues: [openIssue(8, "Ship the widget")],
				pulls: [
					openPull(repo, 40, "Ship the widget", openAndRunAnswered, {
						ref: "40-ship",
					}),
					openPull(repo, 92, "A fix with no ticket", allRunAnswered),
				],
				checkRuns: [{ name: "ci", status: "completed", conclusion: "success" }],
			}),
			{ pinned: [{ tracker: "github", repo }], pmBot: { [repo]: false } },
			new Date("2026-10-18T12:00:00.000Z"),
		);
		expect(items.find((item) => item.key === `${repo}#8`)).toMatchObject({
			reason: "decide",
			openQuestions: 1,
			pull: { number: 40 },
		});
		const answered = items.find((item) => item.key === `${repo}#92`);
		expect(answered).toMatchObject({ reason: "awaitingMerge" });
		expect(answered).not.toHaveProperty("openQuestions");
	});
});
