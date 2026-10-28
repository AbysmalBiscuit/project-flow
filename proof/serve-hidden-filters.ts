import { urlOf } from "../test/support/fetch.ts";
import { recordedDiscovery } from "../test/support/github.ts";
import { repoReadFromLists } from "../test/support/repo-read.ts";
import { emptyLinear, serveRecorded, unrecorded } from "./recorded.ts";

const port = process.argv[2] ?? "4173";
const mode = process.argv[3] ?? "needs-you";
const repo = "acme/widget";

function issue(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-10-18T12:00:00.000Z",
		body: "",
		labels: [{ name: "ready" }],
		...fields,
	};
}

const issues = [
	issue(1, "Ship the map"),
	issue(2, "Draw the legend", { body: `Blocked by: ${repo}#1` }),
];

const view =
	mode === "blocked"
		? { needsYouOnly: false, blockedOnly: true, search: "" }
		: mode === "open"
			? { needsYouOnly: false, blockedOnly: false, search: "" }
			: { needsYouOnly: true, blockedOnly: false, search: "" };

await serveRecorded({
	prefix: "project-flow-hidden-filters-",
	port,
	config: {
		theme: "light",
		pinned: [{ tracker: "github", repo }],
		pollIntervalSeconds: 3600,
		viewerLogins: ["lev"],
		checkoutRoots: [],
		projectViews: { [repo]: view },
	},
	fetch: async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const read = repoReadFromLists(input, init, { [repo]: issues });
		if (read !== null) {
			return read;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		const linear = emptyLinear(url);
		if (linear !== null) {
			return linear;
		}
		return unrecorded(input);
	},
});
