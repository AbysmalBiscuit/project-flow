/** Capture the project graph at the viewports issue 256 names. */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = process.env.PORT ?? "47356";
const base = `http://127.0.0.1:${port}`;
const proof = resolve(root, process.env.PROOF_DIR ?? ".devkit/proof");
const page = "/projects/acme%2Fwidget";
const namespace =
	process.env.AGENT_BROWSER_NAMESPACE ?? `graph-height-${process.pid}`;

const shots = [
	{ name: "graph-1440x1300", width: 1440, height: 1300, item: "1" },
	{ name: "graph-1440x800", width: 1440, height: 800, item: "1" },
	{ name: "graph-390", width: 390, height: 1200, item: "2" },
];

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

function parseEval(raw) {
	const parsed = JSON.parse(raw.trim());
	return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

function measure() {
	const raw = browser([
		"eval",
		`(() => {
			const graph = document.querySelector("#project-graph");
			const main = document.querySelector("main");
			if (!graph || !main) return JSON.stringify({ missing: true });
			const box = graph.getBoundingClientRect();
			const page = document.documentElement;
			return JSON.stringify({
				innerWidth: window.innerWidth,
				innerHeight: window.innerHeight,
				clientWidth: page.clientWidth,
				scrollWidth: page.scrollWidth,
				graphTop: box.top,
				graphBottom: box.bottom,
				graphHeight: box.height,
				minHeight: getComputedStyle(graph).minHeight,
				paddingBottom: getComputedStyle(main).paddingBottom,
			});
		})()`,
	]);
	return parseEval(raw);
}

mkdirSync(proof, { recursive: true });
const server = spawn("bun", ["proof/serve-graph-edges.ts", port], {
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

const lines = [`script proof/graph-height.mjs`, `base ${base}`, `page ${page}`];
let failed = false;

try {
	waitForServer();
	browser(["open", `${base}${page}`]);
	browser(["wait", "--text", "acme/widget"]);
	browser(["wait", "#project-graph"]);
	for (const shot of shots) {
		browser(["set", "viewport", String(shot.width), String(shot.height)]);
		const box = measure();
		const file = `${proof}/${shot.name}.png`;
		browser(["screenshot", "--screenshot-dir", proof, file]);
		const written = statSync(file);
		if (written.size < 1000) {
			throw new Error(`${file} is ${written.size} bytes`);
		}
		const gutter = Number.parseFloat(box.paddingBottom);
		const gap = box.innerHeight - box.graphBottom;
		const sideways = box.scrollWidth > box.clientWidth;
		const floor = Number.parseFloat(box.minHeight);
		const fills =
			shot.width > 390 &&
			Number.isFinite(gutter) &&
			Math.abs(gap - gutter) <= 1;
		const phone =
			shot.width === 390 &&
			!sideways &&
			box.graphHeight + 1 >= floor &&
			floor >= 200;
		const hold = shot.width === 390 ? phone : fills;
		if (!hold) {
			failed = true;
		}
		lines.push(
			[
				shot.name,
				`viewport ${box.innerWidth}x${box.innerHeight}`,
				`item ${shot.item}`,
				`graphBottom ${Math.round(box.graphBottom)}`,
				`window ${box.innerHeight}`,
				`gutter ${box.paddingBottom}`,
				`gap ${Math.round(gap)}`,
				`graphHeight ${Math.round(box.graphHeight)}`,
				`minHeight ${box.minHeight}`,
				`scrollWidth ${box.scrollWidth}`,
				`clientWidth ${box.clientWidth}`,
				`sideways ${sideways}`,
				`shot ${file}`,
				`hold ${hold}`,
			].join(" "),
		);
	}
	writeFileSync(`${proof}/graph-height.log`, `${lines.join("\n")}\n`);
	console.log(lines.join("\n"));
	if (failed) {
		process.exitCode = 1;
	}
} catch (error) {
	console.error(serverLog);
	throw error;
} finally {
	spawnSync("agent-browser", ["close"], {
		encoding: "utf8",
		env: { ...process.env, AGENT_BROWSER_NAMESPACE: namespace },
	});
	server.kill("SIGTERM");
}
