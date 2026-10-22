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

function readScroll(marker, target) {
	const raw = browser([
		"eval",
		`(() => {
			const scroller = [...document.querySelectorAll("div")].find((node) =>
				${target} && node.scrollWidth > node.clientWidth + 8);
			if (!scroller) return JSON.stringify({ missing: true });
			if (scroller.scrollLeft === 0) scroller.scrollLeft = ${marker};
			const button = document.querySelector("[aria-label='Expand panel'], [aria-label='Collapse panel']");
			const key = button && Object.keys(button).find((name) => name.startsWith("__reactProps"));
			const before = Math.round(scroller.scrollLeft);
			if (button && key) button[key].onClick({ preventDefault() {}, stopPropagation() {} });
			const mid = Math.round(scroller.scrollLeft);
			const next = document.querySelector("[aria-label='Expand panel'], [aria-label='Collapse panel']");
			const nextKey = next && Object.keys(next).find((name) => name.startsWith("__reactProps"));
			if (next && nextKey) next[nextKey].onClick({ preventDefault() {}, stopPropagation() {} });
			return JSON.stringify({
				before,
				mid,
				after: Math.round(scroller.scrollLeft),
				sw: scroller.scrollWidth,
				cw: scroller.clientWidth,
			});
		})()`,
	]);
	const parsed = JSON.parse(raw.trim());
	return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
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
	browser(["eval", "document.querySelector('#view-board').click()"]);
	spawnSync("sleep", ["0.6"]);
	browser([
		"eval",
		"document.querySelector(\"button[data-ticket='acme/widget#1']\").dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))",
	]);
	spawnSync("sleep", ["0.3"]);
	const board = readScroll(200, "node.querySelector('[data-ticket]')");
	browser(["eval", "document.querySelector('#view-table').click()"]);
	spawnSync("sleep", ["0.6"]);
	const table = readScroll(33, "node.querySelector('table')");
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
