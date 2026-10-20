/** Move a headed pointer onto Inbox and write hover-light and hover-dark. */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://127.0.0.1:4174";
const proof = process.env.PROOF_DIR ?? ".devkit/proof/item-2";
const namespace =
	process.env.AGENT_BROWSER_NAMESPACE ?? `pointer-hover-${process.pid}`;

function run(args) {
	const result = spawnSync("agent-browser", args, {
		encoding: "utf8",
		env: {
			...process.env,
			AGENT_BROWSER_HEADED: "1",
			AGENT_BROWSER_NAMESPACE: namespace,
		},
	});
	if (result.status !== 0) {
		const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
		throw new Error(`${args.join(" ")} failed: ${detail}`);
	}
	return result.stdout ?? "";
}

function centre(selector) {
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
	return { x: x + width / 2, y: y + height / 2 };
}

function hover(selector) {
	const point = centre(selector);
	run([
		"mouse",
		"move",
		String(Math.round(point.x)),
		String(Math.round(point.y)),
	]);
	const shown = run([
		"eval",
		`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			const style = el ? getComputedStyle(el) : null;
			const hover = Boolean(el?.matches(":hover"));
			const forced = Boolean(el?.hasAttribute("data-hover"));
			const background = style ? style.backgroundColor : "";
			return (hover && !forced ? "pointer " : "miss ") + background;
		})()`,
	]);
	if (!shown.includes("pointer ")) {
		throw new Error(`${selector} is not a pointer hover: ${shown}`);
	}
	const background = shown
		.slice(shown.indexOf("pointer ") + "pointer ".length)
		.trim()
		.replaceAll('"', "");
	return { background };
}

function shot(name) {
	mkdirSync(proof, { recursive: true });
	run(["screenshot", `${proof}/${name}.png`]);
}

function cropNav(name) {
	const script = `
from PIL import Image
source = Image.open(${JSON.stringify(`${proof}/${name}.png`)})
source.crop((300, 8, 460, 56)).save(${JSON.stringify(`${proof}/${name}-nav.png`)})
`;
	const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "nav crop failed");
	}
}

try {
	run(["open", `${base}/`, "--headed"]);
	run(["wait", "--load", "load"]);
	run(["wait", "--text", "All projects"]);
	run(["mouse", "move", "8", "8"]);
	shot("hover-rest");
	cropNav("hover-rest");
	const light = hover("a[href='/inbox']");
	shot("hover-light");
	cropNav("hover-light");
	run(["click", "button[data-theme-toggle]"]);
	run(["wait", "--text", "Overview"]);
	const dark = hover("a[href='/inbox']");
	shot("hover-dark");
	cropNav("hover-dark");
	console.log(
		JSON.stringify({
			light: light.background,
			dark: dark.background,
		}),
	);
} finally {
	spawnSync("agent-browser", ["close"], {
		env: {
			...process.env,
			AGENT_BROWSER_NAMESPACE: namespace,
		},
	});
}
