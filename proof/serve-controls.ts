import {
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import { emptyLinear, serveRecorded, unrecorded } from "./recorded.ts";

const port = process.argv[2] ?? "4177";
const repo = "acme/widget";

function issue(
	number: number,
	title: string,
	label: string,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title,
		state,
		state_reason: state === "closed" ? "completed" : null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-08-01T12:00:00.000Z",
		closed_at: state === "closed" ? "2026-08-01T12:00:00.000Z" : null,
		body: "",
		labels: [{ name: label }],
		assignee: number === 2 ? { login: "lev" } : null,
	};
}

const issues = [
	issue(1, "Keep the card short", "ready"),
	issue(2, "Needs a person", "needs-human"),
	issue(3, "Write the notes", "factory: running"),
	issue(4, "Read the review", "factory: in-review"),
	issue(5, "Ship the board", "done", "closed"),
];

await serveRecorded({
	prefix: "project-flow-217-",
	port,
	config: {
		theme: "light",
		pinned: [{ tracker: "github", repo }],
		pollIntervalSeconds: 3600,
		viewerLogins: ["lev"],
		needsYouLabels: ["needs-human"],
		checkoutRoots: [],
	},
	fetch: async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const read = repoReadFromLists(input, init, { [repo]: issues });
		if (read !== null) {
			const body = await read.json();
			const repository = body.data?.repository;
			if (repository !== undefined) {
				const pageInfo = { hasNextPage: false, endCursor: null };
				repository.labels = {
					nodes: [
						{ name: "ready", color: "d0d7de" },
						{ name: "factory: running", color: "f0c674" },
						{ name: "factory: in-review", color: "9ecbff" },
						{ name: "done", color: "7c5cbf" },
					],
					pageInfo,
				};
				for (const node of repository.issues?.nodes ?? []) {
					node.comments = { nodes: [], pageInfo };
					node.labels = {
						nodes: (node.labels?.nodes ?? []).map(
							(label: { name: string }) => ({
								...label,
								color: "ededed",
							}),
						),
						pageInfo,
					};
					node.blockedBy = { nodes: [], pageInfo };
					node.blocking = { nodes: [], pageInfo };
				}
			}
			return Response.json(body);
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
