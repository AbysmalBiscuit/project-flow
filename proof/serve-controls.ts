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
		stateReason: state === "closed" ? "completed" : null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-08-01T12:00:00.000Z",
		closed_at: state === "closed" ? "2026-08-01T12:00:00.000Z" : null,
		body: "",
		labels: [{ name: label }],
		assignee: number === 2 ? { login: "lev" } : null,
	};
}

type PageInfo = { hasNextPage: boolean; endCursor: null };
type LabelNode = { name?: string; color?: string };
type IssueNode = {
	comments?: { nodes: unknown[]; pageInfo: PageInfo };
	labels?: { nodes: LabelNode[]; pageInfo: PageInfo };
	blockedBy?: { nodes: unknown[]; pageInfo: PageInfo };
	blocking?: { nodes: unknown[]; pageInfo: PageInfo };
};
type RepositoryRead = {
	labels?: { nodes: LabelNode[]; pageInfo: PageInfo };
	issues?: { nodes?: IssueNode[] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function repositoryOf(body: unknown): RepositoryRead | null {
	if (!isRecord(body) || !isRecord(body.data)) {
		return null;
	}
	const repository = body.data.repository;
	return isRecord(repository) ? repository : null;
}

function withLaneLabels(body: unknown): unknown {
	const repository = repositoryOf(body);
	if (repository === null) {
		return body;
	}
	const pageInfo: PageInfo = { hasNextPage: false, endCursor: null };
	repository.labels = {
		nodes: [
			{ name: "ready", color: "d0d7de" },
			{ name: "factory: running", color: "f0c674" },
			{ name: "factory: in-review", color: "9ecbff" },
			{ name: "done", color: "7c5cbf" },
		],
		pageInfo,
	};
	const nodes = repository.issues?.nodes;
	if (nodes === undefined) {
		return body;
	}
	for (const node of nodes) {
		if (!isRecord(node)) {
			continue;
		}
		const issue = node as IssueNode;
		issue.comments = { nodes: [], pageInfo };
		issue.labels = {
			nodes: (issue.labels?.nodes ?? []).flatMap((label) =>
				isRecord(label) && typeof label.name === "string"
					? [{ name: label.name, color: "ededed" }]
					: [],
			),
			pageInfo,
		};
		issue.blockedBy = { nodes: [], pageInfo };
		issue.blocking = { nodes: [], pageInfo };
	}
	return body;
}

const issues = [
	issue(1, "Keep the card short", "ready"),
	issue(2, "Needs a person", "needs-human"),
	issue(3, "Write the notes", "factory: running"),
	issue(4, "Read the review", "factory: in-review"),
	issue(5, "Ship the board", "done", "closed"),
];

await serveRecorded({
	prefix: "project-flow-217e-",
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
			return Response.json(withLaneLabels(await read.json()));
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
