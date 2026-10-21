/**
 * Measure each overview card height on a recorded server.
 * Writes the log under .devkit/proof/. That folder is gitignored.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.env.PORT ?? "4794";
const base = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const proof = process.env.PROOF_DIR ?? ".devkit/proof";
const logPath = `${proof}/walk-260-heights.log`;
const namespace =
	process.env.AGENT_BROWSER_NAMESPACE ?? `measure-260-${process.pid}`;
const root = new URL("..", import.meta.url).pathname;

function browser(args) {
	const result = spawnSync("agent-browser", args, {
		encoding: "utf8",
		env: {
			...process.env,
			AGENT_BROWSER_NAMESPACE: namespace,
		},
	});
	if (result.status !== 0) {
		const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
		throw new Error(`${args.join(" ")} failed: ${detail}`);
	}
	return result.stdout ?? "";
}

function waitForServer() {
	const started = Date.now();
	while (Date.now() - started < 60_000) {
		const probe = spawnSync("curl", ["-sf", "-o", "/dev/null", base], {
			encoding: "utf8",
		});
		if (probe.status === 0) {
			return;
		}
		spawnSync("sleep", ["0.2"]);
	}
	throw new Error(`${base} did not answer`);
}

mkdirSync(proof, { recursive: true });
const server = spawn("bun", ["proof/serve-cards.ts", port], {
	cwd: root,
	stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout?.on("data", (chunk) => {
	serverLog += String(chunk);
});
server.stderr?.on("data", (chunk) => {
	serverLog += String(chunk);
});

try {
	waitForServer();
	browser(["open", base]);
	browser(["wait", "--text", "acme/short"]);
	browser(["wait", "--text", "+5 more"]);
	const raw = browser([
		"eval",
		`(() => {
			const cards = [...document.querySelectorAll("li[id^=project-card]")];
			return JSON.stringify(cards.map((card) => ({
				id: card.id,
				height: card.getBoundingClientRect().height,
			})));
		})()`,
	]);
	const parsed = JSON.parse(raw.trim());
	const cards = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
	if (!Array.isArray(cards) || cards.length === 0) {
		throw new Error(`no overview cards: ${raw}`);
	}
	const heights = cards.map((card) => card.height);
	const lines = [
		`base ${base}`,
		...cards.map((card) => `${card.id} ${card.height}`),
		`equal ${heights.every((height) => height === heights[0])}`,
		`count ${cards.length}`,
	];
	writeFileSync(logPath, `${lines.join("\n")}\n`);
	console.log(lines.join("\n"));
	if (!heights.every((height) => height === heights[0])) {
		process.exitCode = 1;
	}
} finally {
	spawnSync("agent-browser", ["close"], {
		encoding: "utf8",
		env: { ...process.env, AGENT_BROWSER_NAMESPACE: namespace },
	});
	server.kill("SIGTERM");
	if (server.exitCode === null && !server.killed) {
		serverLog = serverLog.trim();
	}
}
