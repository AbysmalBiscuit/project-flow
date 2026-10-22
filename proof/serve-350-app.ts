import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const repo = "AbysmalBiscuit/project-flow";

// Recorded from the real tracker: #97, its sub-issues and the open issues.
const issues = JSON.parse(
	await readFile(join(import.meta.dir, "project-flow-97.json"), "utf8"),
) as Record<string, unknown>[];

await serveRecorded({
	prefix: "project-flow-350-",
	port: process.argv[2] ?? process.env.PORT ?? "4751",
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: {
				openView: "graph",
				groupBy: "workstream",
				graphDirection: "left-to-right",
				maxAgeDays: { Done: 30 },
			},
		},
	},
	fetch: recordedIssues({ [repo]: issues }),
	now: () => new Date("2026-10-22T18:00:00.000Z"),
});
