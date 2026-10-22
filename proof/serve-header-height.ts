import { spawn } from "node:child_process";
import { proofStops } from "./lifetime.ts";

const port = process.argv[2] ?? "4317";
const inner = process.argv[3] ?? "4318";
const phone = process.argv[4] === "390";
const permissionStub = `<script>
Object.defineProperty(window, "Notification", {
	configurable: true,
	value: {
		permission: "default",
		requestPermission: () => Promise.resolve("default"),
	},
});
</script>`;

const child = spawn("bun", ["proof/serve-controls.ts", inner], {
	stdio: ["ignore", "pipe", "inherit"],
});
const stops = proofStops();
void stops.then(() => {
	child.kill("SIGTERM");
});

let upstream = "";
const ready = new Promise<void>((resolve, reject) => {
	const timer = setTimeout(() => {
		reject(new Error("controls server was not ready"));
	}, 9000);
	child.stdout?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		const line = chunk
			.split("\n")
			.map((item) => item.trim())
			.find((item) => item.startsWith("http://"));
		if (line === undefined) {
			return;
		}
		upstream = line;
		clearTimeout(timer);
		resolve();
	});
	child.on("exit", (code) => {
		clearTimeout(timer);
		reject(new Error(`controls server exited ${code ?? "null"}`));
	});
});

await ready;

const lineScript = `(page) => {
	const boxes = page.map(([, node]) => node.getBoundingClientRect());
	const heights = boxes.map((box) => box.height).join(" ");
	const top = boxes[0].top;
	const equal = boxes.every((box) => Math.abs(box.top - top) <= 1) ? "yes" : "no";
	const names = page.map(([name]) => name).join(" ");
	return names + " heights " + heights + " tops-equal " + equal;
}`;

const desktopMeasure = `<script>
const line = ${lineScript};
const fieldset = (id) => document.getElementById(id)?.closest("fieldset");
const read = () => {
	const overview = [
		["overview search", document.querySelector("label[for=overview-search]")],
		["overview view", fieldset("view-cards")],
		["overview refresh", document.getElementById("overview-refresh")],
		["overview notify", document.getElementById("notify-permission")],
	];
	const project = [
		["project filter", document.getElementById("project-filter")],
		["project search", document.getElementById("project-search")],
		["project group", document.getElementById("project-group")],
		["project view", fieldset("view-board")],
	];
	const page = location.pathname.startsWith("/projects/") ? project : overview;
	const missing = page.find(([, node]) => node == null);
	const host = document.getElementById("header-measure");
	if (missing !== undefined || host === null) {
		return;
	}
	const next = line(page);
	if (host.textContent !== next) host.textContent = next;
};
const watch = new MutationObserver(read);
watch.observe(document.documentElement, { childList: true, subtree: true });
read();
</script>`;

function phonePage(app: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Overview header at phone width</title>
<style>
body { margin: 0; background: #111; color: #f4f4f5; font: 16px sans-serif; }
#phone-measure { margin: 0; padding: 8px; }
iframe { display: block; width: 390px; height: 844px; border: 0; background: #fff; }
</style>
</head>
<body>
<p id="phone-measure">phone waiting</p>
<iframe id="phone-frame" title="Overview at 390px" src="${app}"></iframe>
<script>
const line = ${lineScript};
const frame = document.getElementById("phone-frame");
const host = document.getElementById("phone-measure");
const read = () => {
	const doc = frame.contentDocument;
	if (doc === null || doc.getElementById("notify-permission") === null) {
		return;
	}
	const fieldset = doc.getElementById("view-cards")?.closest("fieldset");
	const page = [
		["overview search", doc.querySelector("label[for=overview-search]")],
		["overview view", fieldset],
		["overview refresh", doc.getElementById("overview-refresh")],
		["overview notify", doc.getElementById("notify-permission")],
	];
	if (page.some(([, node]) => node == null)) {
		return;
	}
	const root = doc.documentElement;
	const rows = [];
	for (const item of page) {
		const top = item[1].getBoundingClientRect().top;
		const last = rows.at(-1);
		const same = last !== undefined && Math.abs(last[0][1].getBoundingClientRect().top - top) <= 1;
		if (same) {
			last.push(item);
		} else {
			rows.push([item]);
		}
	}
	const next = [
		"phone",
		...rows.map((row) => line(row)),
		"scrollWidth " + root.scrollWidth,
	].join(" ");
	if (host.textContent !== next) host.textContent = next;
};
frame.addEventListener("load", () => {
	const doc = frame.contentDocument;
	if (doc === null) {
		return;
	}
	const watch = new MutationObserver(read);
	watch.observe(doc.documentElement, { childList: true, subtree: true });
	read();
});
</script>
</body>
</html>`;
}

Bun.serve({
	hostname: "127.0.0.1",
	port: Number(port),
	async fetch(request) {
		const url = new URL(request.url);
		if (phone && (url.pathname === "/" || url.pathname === "/phone")) {
			return new Response(phonePage("/app/"), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		const upstreamPath = url.pathname.startsWith("/app")
			? url.pathname.slice("/app".length) || "/"
			: url.pathname;
		const target = new URL(upstreamPath + url.search, upstream);
		const response = await fetch(target, {
			method: request.method,
			headers: request.headers,
			...(request.method === "GET" || request.method === "HEAD"
				? {}
				: { body: request.body }),
		});
		const type = response.headers.get("content-type") ?? "";
		if (!type.includes("text/html")) {
			return response;
		}
		const html = await response.text();
		const measure = phone
			? ""
			: `<p id="header-measure">header waiting</p>${desktopMeasure}`;
		const withStub = html.includes("<head>")
			? html.replace("<head>", `<head>${permissionStub}`)
			: `${permissionStub}${html}`;
		const marked = withStub.includes("</body>")
			? withStub.replace("</body>", `${measure}</body>`)
			: `${withStub}${measure}`;
		return new Response(marked, {
			status: response.status,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	},
});

console.log(`http://127.0.0.1:${port}/`);
await stops;
