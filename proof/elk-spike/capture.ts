/**
 * Records the project reports and tracker responses that `measure.ts` reads.
 *
 * Usage: bun proof/elk-spike/capture.ts OUT_DIR
 *
 * The app runs once on a temporary `XDG_DATA_HOME` and reads the trackers with
 * `GITHUB_TOKEN` or `gh`, and `LINEAR_API_KEY`. The recording `fetch` refuses
 * every write. OUT_DIR holds real ticket data: keep it out of the repository.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../../src/fetch.ts";
import { readGhAuthToken, run } from "../../src/main.ts";

const capturedProjects = [
	"AbysmalBiscuit/project-flow",
	"AbysmalBiscuit/workcell",
	"Initial SDI Issues",
] as const;

const out = process.argv[2];
if (out === undefined || out.trim() === "") {
	console.error("usage: bun proof/elk-spike/capture.ts OUT_DIR");
	process.exit(1);
}
const root = await mkdtemp(join(out, "xdg-"));
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	JSON.stringify({
		tracked: [
			{ tracker: "github", repo: "AbysmalBiscuit/project-flow" },
			{ tracker: "github", repo: "AbysmalBiscuit/workcell" },
			{ tracker: "linear", project: "10ad57098f5b" },
		],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
	}),
);

const recorded: { url: string; body: string; status: number; text: string }[] =
	[];
const recording: Fetch = async (input, init) => {
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	// The workcell repository read exceeds GitHub's GraphQL resource limit at
	// pages of 100, so the capture asks for smaller pages.
	const body = (typeof init?.body === "string" ? init.body : "")
		.replace("issues(first: 100,", "issues(first: 20,")
		.replace("pullRequests(first: 100,", "pullRequests(first: 20,");
	const method = init?.method ?? "GET";
	if (method !== "GET" && !(method === "POST" && url.endsWith("/graphql"))) {
		throw new Error(`capture refuses a write: ${method} ${url}`);
	}
	if (/\bmutation\b/.test(body)) {
		throw new Error("capture refuses a mutation");
	}
	const response = await fetch(input, body === "" ? init : { ...init, body });
	const text = await response.text();
	recorded.push({ url, body, status: response.status, text });
	return new Response(text, {
		status: response.status,
		headers: response.headers,
	});
};

let base = "";
let stop = () => {};
const stopped = new Promise<void>((resolve) => {
	stop = resolve;
});
const running = run(["--config", configPath, "--port", "0"], {
	env: { ...process.env, XDG_DATA_HOME: root },
	fetch: recording,
	readGhToken: readGhAuthToken,
	databasePath: join(root, "project-flow.sqlite"),
	listTodos: async () => "",
	listCheckouts: async () => [],
	stdout: (line) => {
		const found = line.match(/https?:\/\/\S+/)?.[0];
		if (found !== undefined) {
			base = new URL(found).origin;
		}
	},
	stderr: (line) => console.error(line),
	waitForStop: stopped,
});

const reportUrl = (name: string, view: string) =>
	`${base}/api/projects/${encodeURIComponent(name)}?view=${view}`;
let ready = false;
for (let tries = 0; tries < 200 && !ready; tries += 1) {
	await Bun.sleep(5000);
	if (base === "") {
		continue;
	}
	const sizes = await Promise.all(
		capturedProjects.map(async (name) => {
			const response = await fetch(reportUrl(name, "all"));
			if (!response.ok) {
				return 0;
			}
			const report: { graphTickets: unknown[] } = await response.json();
			return report.graphTickets.length;
		}),
	);
	console.log("graph tickets so far:", sizes.join(", "));
	ready = sizes.every((size) => size > 0);
}
if (ready) {
	await Bun.sleep(20_000);
	for (const [index, name] of capturedProjects.entries()) {
		for (const view of ["all", "filtered"]) {
			const response = await fetch(reportUrl(name, view));
			await writeFile(
				join(out, `report-${index}-${view}.json`),
				await response.text(),
			);
		}
	}
	await writeFile(join(out, "recorded.json"), JSON.stringify(recorded));
	console.log(`recorded ${recorded.length} responses in ${out}`);
} else {
	console.error("a project report stayed empty; nothing written");
	process.exitCode = 1;
}
stop();
await running;
