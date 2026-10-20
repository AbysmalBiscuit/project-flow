import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedViewer, urlOf } from "../test/support.ts";

const root =
	process.env.XDG_DATA_HOME ??
	(await mkdtemp(join("/var/tmp", "project-flow-board-")));
const configPath = join(root, "config.json");
const widget = "acme/widget";
const platform = "acme/platform";

await writeFile(
	configPath,
	JSON.stringify({
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: platform },
		],
		pollIntervalSeconds: 3600,
	}),
);

function issue(
	repo: string,
	number: number,
	title: string,
	body = "",
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title,
		state,
		state_reason: state === "closed" ? "completed" : null,
		updated_at: `2026-08-${String(number).padStart(2, "0")}T12:00:00Z`,
		html_url: `https://github.com/${repo}/issues/${number}`,
		body,
	};
}

const widgetIssues = [
	issue(widget, 1, "Ship the board"),
	issue(widget, 2, "Draw the nodes", `Blocked by: ${platform}#9`),
	issue(widget, 3, "Write the copy"),
	issue(widget, 4, "Read the review"),
	...[11, 12, 13, 14, 15, 16].map((number) =>
		issue(widget, number, `Close item ${number}`, "", "closed"),
	),
];

const platformIssues = [
	issue(platform, 9, "Platform gate"),
	issue(platform, 10, "Hold the launch", `Blocked by: ${widget}#2`),
];

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const recorded: Fetch = async (input, init) => {
	const known = recordedViewer(input, init);
	if (known !== null) {
		return known;
	}
	const url = urlOf(input);
	if (url.includes(`/repos/${widget}/issues?`)) {
		return page(widgetIssues);
	}
	if (url.includes(`/repos/${platform}/issues?`)) {
		return page(platformIssues);
	}
	const issueUrl = url.match(
		/https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/,
	);
	if (issueUrl?.[1] !== undefined && issueUrl[2] !== undefined) {
		const repo = issueUrl[1];
		const number = Number(issueUrl[2]);
		const found = [...widgetIssues, ...platformIssues].find(
			(item) => item.number === number && String(item.html_url).includes(repo),
		);
		if (found === undefined) {
			return new Response("not recorded", { status: 404 });
		}
		return new Response(JSON.stringify(found), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (url.endsWith("/comments") && url.includes("/issues/")) {
		return page([
			{
				id: 70,
				body: "The notes are ready.",
				user: { login: "lev" },
				html_url: `${url}#issuecomment-70`,
				created_at: "2026-08-18T12:00:00Z",
			},
		]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments")
	) {
		return page([]);
	}
	return new Response("not recorded", { status: 404 });
};

const port = process.env.PORT ?? "4173";
await run(["--config", configPath, "--host", "127.0.0.1", "--port", port], {
	env: { GITHUB_TOKEN: "recorded-token" },
	fetch: recorded,
	readGhToken: async () => null,
	listTodos: async () => "",
	listCheckouts: async () => [],
	databasePath: join(root, "project-flow.sqlite"),
	now: () => new Date("2026-08-18T12:00:00.000Z"),
	stdout: (line) => {
		console.log(line);
		void fetch(
			new URL(`/api/projects/${encodeURIComponent(widget)}`, line.trim()),
		)
			.then(async (response) => {
				if (!response.ok) {
					console.error(`project load failed (HTTP ${response.status})`);
					return;
				}
				const body = (await response.json()) as {
					tickets?: { title?: string }[];
				};
				const titled = body.tickets?.some(
					(ticket) => ticket.title === "Ship the board",
				);
				if (!titled) {
					console.error("project load returned no board ticket");
				}
			})
			.catch((error: unknown) => {
				console.error(
					error instanceof Error ? error.message : "project load failed",
				);
			});
	},
	stderr: (line) => console.error(line),
	waitForStop: new Promise<void>((resolve) => {
		const stop = () => resolve();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	}),
});
