/** Record Esc closing the ticket search from the input and from a result. */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = "http://127.0.0.1:4188";
const proof = ".devkit/proof/item-177-escape";
const namespace = `escape-search-${process.pid}`;
const root = new URL("..", import.meta.url).pathname;
let sessionDir = "";

function browser(args) {
	const result = spawnSync("proofshot", ["exec", ...args], {
		encoding: "utf8",
		cwd: root,
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

function evalText(source) {
	return browser(["eval", source]).trim().replaceAll('"', "");
}

function focusId() {
	return evalText(
		"document.activeElement instanceof HTMLElement ? document.activeElement.id : ''",
	);
}

function dialogOpen() {
	return evalText(
		"document.querySelector('[role=dialog][aria-label=\"Search tickets\"]') ? 'open' : 'closed'",
	);
}

function shot(name) {
	mkdirSync(proof, { recursive: true });
	browser(["screenshot", `${name}.png`]);
	const saved = spawnSync("cp", [
		`${root}proofshot-artifacts/${sessionDir}/${name}.png`,
		`${root}${proof}/${name}.png`,
	]);
	if (saved.status !== 0) {
		const detail = (saved.stderr ?? "").toString().trim();
		throw new Error(`could not copy ${name}.png: ${detail}`);
	}
}

const server = spawn("bun", ["proof/serve-jump.ts"], {
	cwd: root,
	stdio: "ignore",
	detached: true,
});

try {
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		const probe = spawnSync("curl", ["-sf", "-o", "/dev/null", base]);
		if (probe.status === 0) {
			break;
		}
		if (server.exitCode !== null) {
			throw new Error("serve-jump exited before the page answered");
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	const ready = spawnSync("curl", ["-sf", "-o", "/dev/null", base]);
	if (ready.status !== 0) {
		throw new Error(`page not reachable at ${base}`);
	}
	const started = spawnSync(
		"proofshot",
		[
			"start",
			"--port",
			"4188",
			"--description",
			"Esc closes the ticket search from the input and from a result",
		],
		{ cwd: root, encoding: "utf8", env: process.env },
	);
	if (started.status !== 0) {
		throw new Error(
			`proofshot start failed: ${(started.stderr ?? started.stdout ?? "").trim()}`,
		);
	}
	const listed = spawnSync(
		"bash",
		["-c", `ls -td ${root}proofshot-artifacts/*/ | head -1`],
		{ encoding: "utf8" },
	);
	sessionDir =
		(listed.stdout ?? "").trim().replace(/\/$/, "").split("/").at(-1) ?? "";
	if (sessionDir === "") {
		throw new Error(
			`proofshot start wrote no session directory: ${(listed.stderr ?? "").trim()}`,
		);
	}

	browser(["open", `${base}/`]);
	browser(["wait", "--text", "Overview"]);
	mkdirSync(proof, { recursive: true });
	browser([
		"record",
		"start",
		`${root}${proof}/escape-search.webm`,
		"--fps",
		"15",
	]);
	browser(["click", "#header-search"]);
	browser(["wait", "#jump-query"]);
	browser(["fill", "#jump-query", "widget"]);
	browser(["wait", "--text", "Ship the widget"]);
	browser(["focus", "#jump-query"]);
	if (dialogOpen() !== "open") {
		throw new Error("search did not open from the header");
	}
	shot("search-open-input");
	browser(["press", "Escape"]);
	browser(["wait", "#header-search"]);
	if (dialogOpen() !== "closed") {
		throw new Error("Escape with focus in the input left the search open");
	}
	if (focusId() !== "header-search") {
		throw new Error(`Escape from the input focused #${focusId() || "(none)"}`);
	}
	shot("closed-from-input");

	browser(["click", "#header-search"]);
	browser(["wait", "#jump-query"]);
	browser(["fill", "#jump-query", "widget"]);
	browser(["wait", "--text", "Ship the widget"]);
	browser(["focus", "[data-ticket='acme/board#12']"]);
	const onResult = evalText(
		"document.activeElement?.getAttribute('data-ticket') ?? ''",
	);
	if (onResult !== "acme/board#12") {
		throw new Error(`result focus landed on ${onResult || "(none)"}`);
	}
	shot("search-open-result");
	browser(["press", "Escape"]);
	browser(["wait", "#header-search"]);
	if (dialogOpen() !== "closed") {
		throw new Error("Escape with focus on a result left the search open");
	}
	if (focusId() !== "header-search") {
		throw new Error(`Escape from a result focused #${focusId() || "(none)"}`);
	}
	shot("closed-from-result");
	browser(["record", "stop"]);
	spawnSync("proofshot", ["stop"], {
		cwd: root,
		env: { ...process.env, AGENT_BROWSER_NAMESPACE: namespace },
	});
	console.log(
		"escape-search: dialog closed and focus on #header-search from input and result",
	);
} finally {
	spawnSync("proofshot", ["stop"], {
		cwd: root,
		env: { ...process.env, AGENT_BROWSER_NAMESPACE: namespace },
	});
	spawnSync("proofshot", ["exec", "close"], {
		cwd: root,
		env: { ...process.env, AGENT_BROWSER_NAMESPACE: namespace },
	});
	if (server.pid !== undefined) {
		try {
			process.kill(-server.pid, "SIGTERM");
		} catch {
			server.kill("SIGTERM");
		}
	}
}
