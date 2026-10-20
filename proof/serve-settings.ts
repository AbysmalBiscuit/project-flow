import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import { emptyLinear, serveRecorded, unrecorded } from "./recorded.ts";

const linear = {
	key: "PLAT",
	name: "Platform",
	pinned: false,
	hidden: false,
	bots: ["greptile"] as const,
};

const rows = [
	{
		key: "AbysmalBiscuit/project-flow",
		name: "project-flow",
		pinned: true,
		hidden: false,
		bots: ["grok", "codex"],
	},
	{
		key: "AbysmalBiscuit/workcell",
		name: "workcell",
		pinned: true,
		hidden: false,
		bots: ["codex"],
	},
	{
		key: "AbysmalBiscuit/devkit",
		name: "devkit",
		pinned: false,
		hidden: false,
		bots: [],
	},
	{
		key: "AbysmalBiscuit/sortie",
		name: "sortie",
		pinned: false,
		hidden: false,
		bots: ["codex"],
	},
	{
		key: "AbysmalBiscuit/herdr",
		name: "herdr",
		pinned: false,
		hidden: false,
		bots: [],
	},
];

function issue(repo: string): Record<string, unknown> {
	return {
		number: 1,
		title: "Open ticket",
		state: "open",
		state_reason: null,
		updated_at: "2026-10-18T12:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/1`,
	};
}

const recorded: Fetch = async (input, init) => {
	const url = urlOf(input);

	if (url === "https://api.github.com/user") {
		return Response.json({ login: "AbysmalBiscuit" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		const page = new URL(url).searchParams.get("page");
		if (page !== null && page !== "1") {
			return Response.json([]);
		}
		return Response.json(
			rows.map((row) => ({
				full_name: row.key,
				owner: { login: "AbysmalBiscuit" },
				permissions: { push: true },
				pushed_at: "2026-10-18T12:00:00Z",
			})),
		);
	}
	const issues = url.match(
		/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?/,
	);
	if (issues?.[1] !== undefined) {
		return Response.json([issue(issues[1])]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions")
	) {
		return Response.json([]);
	}
	if (url.includes("/check-runs")) {
		return Response.json({ check_runs: [] });
	}
	if (url === "https://api.linear.app/graphql") {
		const query = typeof init?.body === "string" ? init.body : "";
		if (query.includes("MemberProjects")) {
			return Response.json({
				data: {
					projects: {
						nodes: [
							{
								id: "plat",
								name: linear.name,
								slugId: linear.key,
								updatedAt: "2026-10-18T12:00:00Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			});
		}
		return Response.json({ data: { viewer: { id: "lev" } } });
	}
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null && url !== "https://api.github.com/graphql") {
		return discovered;
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({
			data: {
				viewer: {
					login: "AbysmalBiscuit",
					projectsV2: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					organizations: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	return emptyLinear(url) ?? unrecorded(input);
};

const port = process.argv[2] ?? "4187";

await serveRecorded({
	prefix: "project-flow-settings-",
	port,
	config: {
		pinned: rows.flatMap((row) =>
			row.pinned ? [{ tracker: "github", repo: row.key }] : [],
		),
		hidden: rows.flatMap((row) =>
			row.hidden ? [{ tracker: "github", repo: row.key }] : [],
		),
		expectedBots: Object.fromEntries([
			...rows.flatMap((row) =>
				row.bots.length === 0 ? [] : [[row.key, row.bots]],
			),
			[linear.key, [...linear.bots]],
		]),
		pmBot: Object.fromEntries(
			rows.flatMap((row) => (row.pinned ? [[row.key, true]] : [])),
		),
		checkoutRoots: [],
		pollIntervalSeconds: 60,
		activityWindowDays: 30,
		viewerLogins: ["AbysmalBiscuit"],
		projectViews: {
			"*": {
				openView: "board",
				graphDirection: "left-to-right",
				shownLanes: [
					"Ready",
					"In progress",
					"In review",
					"Awaiting merge",
					"Done",
				],
				maxAgeDays: { Done: 2 },
			},
		},
	},
	fetch: recorded,
});
