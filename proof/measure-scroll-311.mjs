/**
 * Measure view scroll across expand and collapse.
 * Writes the log under .devkit/proof/. That folder is gitignored.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.env.PORT ?? "4395";
const base = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const proof = process.env.PROOF_DIR ?? ".devkit/proof";
const logPath = `${proof}/walk-311-scroll.log`;
const namespace =
	process.env.AGENT_BROWSER_NAMESPACE ?? `measure-311-${process.pid}`;
const root = new URL("..", import.meta.url).pathname;
const page = `${base}/projects/acme%2Fwidget`;

function browser(args) {
	const result = spawnSync("agent-browser", args, {
		encoding: "utf8",
		env: { ...process.env, AGENT_BROWSER_NAMESPACE: namespace },
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

function readScroller(target) {
	const raw = browser([
		"eval",
		`(() => {
			const scroller = [...document.querySelectorAll("div")].find((node) =>
				${target} && node.scrollWidth > node.clientWidth + 8);
			if (!scroller) return JSON.stringify({ missing: true });
			scroller.dataset.scrollProbe = "1";
			const panel = document.querySelector("[data-panel]");
			const box = panel ? panel.getBoundingClientRect() : null;
			return JSON.stringify({
				left: Math.round(scroller.scrollLeft),
				sw: scroller.scrollWidth,
				cw: scroller.clientWidth,
				expanded: panel ? panel.dataset.expanded : null,
				visible: box ? box.width > 8 && box.height > 8 : false,
			});
		})()`,
	]);
	const parsed = JSON.parse(raw.trim());
	return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

function setScroll(marker) {
	browser([
		"eval",
		`document.querySelector("[data-scroll-probe='1']").scrollLeft = ${marker}`,
	]);
}

function waitVisible(label, expanded) {
	const started = Date.now();
	let last = null;
	while (Date.now() - started < 8_000) {
		browser(["wait", "--text", label]);
		last = readScroller("node.dataset.scrollProbe === '1'");
		if (last.expanded === expanded && last.visible === true) {
			return last;
		}
		spawnSync("sleep", ["0.1"]);
	}
	throw new Error(
		`panel did not reach visible ${expanded}: ${JSON.stringify(last)}`,
	);
}

function clickLabel(label) {
	browser(["click", `[aria-label='${label}']`]);
}

function measureCycle(marker, target) {
	const found = readScroller(target);
	if (found.missing) {
		return found;
	}
	setScroll(marker);
	const before = readScroller("node.dataset.scrollProbe === '1'");
	clickLabel("Expand panel");
	const mid = waitVisible("Collapse", "true");
	clickLabel("Collapse panel");
	const after = waitVisible("Expand", "false");
	return {
		before: before.left,
		mid: mid.left,
		after: after.left,
		sw: after.sw,
		cw: after.cw,
		midSw: mid.sw,
		midCw: mid.cw,
	};
}

mkdirSync(proof, { recursive: true });
const server = spawn("bun", ["proof/serve-board.ts", port], {
	cwd: root,
	stdio: ["ignore", "pipe", "pipe"],
});

try {
	waitForServer();
	browser(["open", page]);
	browser(["wait", "--text", "Ship the board"]);
	browser(["click", "#view-board"]);
	browser(["wait", "button[data-ticket='acme/widget#1']"]);
	browser(["click", "button[data-ticket='acme/widget#1']"]);
	browser(["wait", "[aria-label='Expand panel']"]);
	const board = measureCycle(200, "node.querySelector('[data-ticket]')");
	browser(["click", "#view-table"]);
	browser(["wait", "--text", "Close item 16"]);
	spawnSync("sleep", ["0.4"]);
	const table = measureCycle(33, "node.querySelector('table')");
	const kept =
		board.before === board.mid &&
		board.mid === board.after &&
		board.before === 200 &&
		table.before === table.mid &&
		table.mid === table.after &&
		table.before === 33;
	const lines = [
		`base ${base}`,
		`board before=${board.before} expanded=${board.mid} collapsed=${board.after} sw=${board.sw} cw=${board.cw}`,
		`table before=${table.before} expanded=${table.mid} collapsed=${table.after} sw=${table.sw} cw=${table.cw}`,
		`scroll-kept ${kept}`,
	];
	writeFileSync(logPath, `${lines.join("\n")}\n`);
	console.log(lines.join("\n"));
	if (!kept) {
		process.exitCode = 1;
	}
} finally {
	server.kill();
}
