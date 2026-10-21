import { serveRecorded } from "./recorded.ts";
import { recorded } from "./serve-title-row.ts";

const port = process.argv[2] ?? "47261";
const openView = process.argv[3] ?? "board";

await serveRecorded({
	prefix: "project-flow-header-",
	port,
	config: {
		pinned: [{ tracker: "github", repo: "acme/widget" }],
		checkoutRoots: [],
		pmBot: { "acme/widget": false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			"acme/widget": { openView, groupBy: "none" },
		},
	},
	fetch: recorded,
});
