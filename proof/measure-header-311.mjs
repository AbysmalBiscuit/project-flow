/**
 * Measure the expanded panel header on a scrolled list page.
 * Writes the log under .devkit/proof/. That folder is gitignored.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.env.PORT ?? "4396";
const base = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;
const proof = process.env.PROOF_DIR ?? ".devkit/proof";
const logPath = `${proof}/walk-311-header.log`;
const namespace =
	process.env.AGENT_BROWSER_NAMESPACE ?? `measure-311-header-${process.pid}`;
const root = new URL("..", import.meta.url).pathname;

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

function evaluate(expression) {
	const parsed = JSON.parse(browser(["eval", expression]).trim());
	return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
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

const measure = `JSON.stringify((() => {
	const main = document.querySelector("body main");
	const panel = document.querySelector("[data-panel]");
	const head = panel.firstElementChild.getBoundingClientRect();
	const box = main.getBoundingClientRect();
	return {
		scroll: Math.round(main.scrollTop),
		viewTop: Math.round(box.top),
		viewBottom: Math.round(box.bottom),
		headTop: Math.round(head.top),
		expanded: panel.dataset.expanded,
	};
})())`;

function clickNode(selector) {
	browser([
		"eval",
		`document.querySelector(${JSON.stringify(selector)}).click()`,
	]);
}

function measurePage(path, opener) {
	browser(["open", `${base}${path}`]);
	browser(["wait", "--text", "Ready to merge"]);
	clickNode(opener);
	browser(["wait", "[aria-label='Expand panel']"]);
	browser(["eval", `document.querySelector("body main").scrollTop = 99999`]);
	clickNode("[aria-label='Expand panel']");
	browser(["wait", "--text", "Collapse"]);
	spawnSync("sleep", ["0.3"]);
	return evaluate(measure);
}

mkdirSync(proof, { recursive: true });
const server = spawn("bun", ["proof/serve-needs-you.ts", port], {
	cwd: root,
	stdio: ["ignore", "pipe", "pipe"],
});

try {
	waitForServer();
	browser(["set", "viewport", "1280", "500"]);
	const pages = {
		needs: measurePage("/needs-you", "[data-needs='acme/widget#8'] button"),
		inbox: measurePage("/inbox", "button[data-inbox]"),
	};
	const lines = [`base ${base} viewport 1280x500`];
	let shown = true;
	for (const [name, page] of Object.entries(pages)) {
		const visible =
			page.scroll > 0 &&
			page.expanded === "true" &&
			page.headTop >= page.viewTop &&
			page.headTop < page.viewBottom;
		shown &&= visible;
		lines.push(
			`${name} scroll=${page.scroll} view=${page.viewTop}-${page.viewBottom} head=${page.headTop} visible=${visible}`,
		);
	}
	lines.push(`header-shown ${shown}`);
	writeFileSync(logPath, `${lines.join("\n")}\n`);
	console.log(lines.join("\n"));
	if (!shown) {
		process.exitCode = 1;
	}
} finally {
	server.kill();
}
