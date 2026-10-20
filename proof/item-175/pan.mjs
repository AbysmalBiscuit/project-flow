/** Drag the overview graph with a real pointer and assert the viewport. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://127.0.0.1:47923";
const proof = process.env.PROOF_DIR ?? ".devkit/proof/item-175";
const namespace =
	process.env.AGENT_BROWSER_NAMESPACE ?? `graph-pan-${process.pid}`;

function closeBrowser() {
	spawnSync("agent-browser", ["close"], {
		env: {
			...process.env,
			AGENT_BROWSER_NAMESPACE: namespace,
		},
	});
}

function run(args) {
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

function pointIn(rect, x, y) {
	return (
		x >= rect.x &&
		x <= rect.x + rect.width &&
		y >= rect.y &&
		y <= rect.y + rect.height
	);
}

function backgroundPoint(pane, node) {
	const candidates = [
		{ x: pane.x + 40, y: pane.y + 40 },
		{ x: pane.x + 40, y: pane.y + pane.height - 40 },
		{ x: pane.x + pane.width - 40, y: pane.y + 40 },
		{ x: pane.x + pane.width / 2, y: pane.y + 40 },
	];
	for (const candidate of candidates) {
		if (!pointIn(pane, candidate.x, candidate.y)) {
			continue;
		}
		if (pointIn(node, candidate.x, candidate.y)) {
			continue;
		}
		const hit = evalPage(
			`document.elementFromPoint(${Math.round(candidate.x)}, ${Math.round(candidate.y)})?.className ?? ""`,
		);
		if (typeof hit === "string" && hit.includes("react-flow__pane")) {
			return candidate;
		}
	}
	throw new Error("no graph background point");
}

function box(selector) {
	const raw = run(["get", "box", selector]);
	const x = Number(raw.match(/x:\s+([0-9.]+)/)?.[1]);
	const y = Number(raw.match(/y:\s+([0-9.]+)/)?.[1]);
	const width = Number(raw.match(/width:\s+([0-9.]+)/)?.[1]);
	const height = Number(raw.match(/height:\s+([0-9.]+)/)?.[1]);
	if (
		![x, y, width, height].every(Number.isFinite) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(`no box for ${selector}: ${raw}`);
	}
	return { x, y, width, height };
}

function move(x, y) {
	run([
		"mouse",
		"move",
		String(Math.round(x)),
		String(Math.round(y)),
		"--duration",
		"400",
		"--steps",
		"12",
	]);
}

function drag(from, to) {
	move(from.x, from.y);
	run(["mouse", "down", "left"]);
	move(to.x, to.y);
	run(["mouse", "up", "left"]);
}

function cdp(method, params, sessionId) {
	const next = cdp.next++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cdp.socket.removeEventListener("message", onMessage);
			reject(new Error(`${method} timed out`));
		}, 5000);
		function onMessage(event) {
			const message = JSON.parse(event.data);
			if (message.id !== next) {
				return;
			}
			clearTimeout(timer);
			cdp.socket.removeEventListener("message", onMessage);
			if (message.error) {
				reject(new Error(`${method}: ${message.error.message}`));
				return;
			}
			resolve(message.result);
		}
		cdp.socket.addEventListener("message", onMessage);
		cdp.socket.send(
			JSON.stringify({
				id: next,
				method,
				params,
				...(sessionId === undefined ? {} : { sessionId }),
			}),
		);
	});
}
cdp.next = 1;

async function wheel(point) {
	const listed = JSON.parse(run(["--json", "get", "cdp-url"]));
	cdp.socket = new WebSocket(listed.data.cdpUrl);
	await new Promise((resolve, reject) => {
		cdp.socket.addEventListener("open", resolve, { once: true });
		cdp.socket.addEventListener(
			"error",
			() => {
				reject(new Error("cdp socket failed"));
			},
			{ once: true },
		);
	});
	try {
		const targets = await cdp("Target.getTargets", {});
		const page = targets.targetInfos.find(
			(item) => item.type === "page" && item.url.startsWith("http://127.0.0.1"),
		);
		if (page === undefined) {
			throw new Error("no page target");
		}
		const attached = await cdp("Target.attachToTarget", {
			targetId: page.targetId,
			flatten: true,
		});
		await cdp(
			"Input.dispatchMouseEvent",
			{
				type: "mouseWheel",
				x: Math.round(point.x),
				y: Math.round(point.y),
				deltaX: 0,
				deltaY: 120,
			},
			attached.sessionId,
		);
	} finally {
		cdp.socket.close();
	}
}

function evalPage(source) {
	const raw = run(["eval", source]);
	const line = raw
		.trim()
		.split("\n")
		.find((item) => item.startsWith('"') || item.startsWith("{"));
	if (line === undefined) {
		throw new Error(`empty eval: ${raw}`);
	}
	return JSON.parse(line);
}

function readState() {
	const raw = evalPage(`JSON.stringify((() => {
		const text = document.querySelector("#graph-viewport")?.textContent ?? "";
		const match = text.match(/zoom ([0-9.]+) at (-?[0-9]+),(-?[0-9]+)/);
		const node = document.querySelector(".react-flow__node");
		const transform = node ? getComputedStyle(node).transform : "";
		return {
			zoom: match ? Number(match[1]) : null,
			x: match ? Number(match[2]) : null,
			y: match ? Number(match[3]) : null,
			transform,
		};
	})())`);
	const state = JSON.parse(raw);
	if (
		typeof state.zoom !== "number" ||
		typeof state.x !== "number" ||
		typeof state.y !== "number" ||
		typeof state.transform !== "string" ||
		state.transform === "" ||
		state.transform === "none"
	) {
		throw new Error(`graph state missing: ${raw}`);
	}
	return state;
}

function shot(name) {
	mkdirSync(proof, { recursive: true });
	const path = `${proof}/${name}.png`;
	run(["screenshot", path]);
	const bytes = readFileSync(path);
	if (
		!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	) {
		throw new Error(`${path} is not a PNG`);
	}
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	writeFileSync(`${proof}/${name}.sha256`, `${sha256}  ${name}.png\n`);
	return { path, sha256 };
}

try {
	await prove();
} finally {
	closeBrowser();
}

async function prove() {
	run(["open", `${base}/`]);
	run(["wait", "--load", "load"]);
	run(["wait", "--text", "Overview"]);
	run(["wait", "#view-graph"]);
	run(["wait", "--text", "acme/widget"]);
	run(["click", "#view-graph"]);
	run(["wait", "#graph-viewport"]);
	run(["wait", ".react-flow__node"]);
	mkdirSync(proof, { recursive: true });
	run(["record", "start", `${proof}/session.webm`, "--fps", "30", "--cursor"]);
	const pane = box(".react-flow__pane");
	const node = box(".react-flow__node");
	const background = backgroundPoint(pane, node);
	const before = readState();

	drag(
		{ x: node.x + node.width / 2, y: node.y + node.height / 2 },
		{ x: node.x + node.width / 2 + 80, y: node.y + node.height / 2 + 40 },
	);
	const afterNode = readState();
	if (afterNode.transform !== before.transform) {
		throw new Error(
			`node drag moved the node: ${before.transform} -> ${afterNode.transform}`,
		);
	}

	drag(background, { x: background.x + 140, y: background.y + 70 });
	const afterPan = readState();
	if (afterPan.transform !== before.transform) {
		throw new Error(
			`background drag moved the node: ${before.transform} -> ${afterPan.transform}`,
		);
	}
	const panX = afterPan.x - before.x;
	const panY = afterPan.y - before.y;
	if (Math.hypot(panX, panY) < 40) {
		throw new Error(
			`background drag did not pan: ${before.x},${before.y} -> ${afterPan.x},${afterPan.y}`,
		);
	}

	await wheel(background);
	const afterZoom = readState();
	if (afterZoom.transform !== before.transform) {
		throw new Error(
			`wheel moved the node: ${before.transform} -> ${afterZoom.transform}`,
		);
	}
	if (afterZoom.zoom >= afterPan.zoom) {
		throw new Error(`wheel did not zoom: zoom stayed ${afterZoom.zoom}`);
	}

	const image = shot("overview-graph-panned");
	run(["record", "stop"]);
	console.log(
		JSON.stringify({
			viewportBefore: { x: before.x, y: before.y, zoom: before.zoom },
			viewportAfterPan: { x: afterPan.x, y: afterPan.y, zoom: afterPan.zoom },
			viewportAfterZoom: {
				x: afterZoom.x,
				y: afterZoom.y,
				zoom: afterZoom.zoom,
			},
			nodeTransform: before.transform,
			shot: image.path,
			sha256: image.sha256,
		}),
	);
}
