import { proofStops, proofTheme } from "./lifetime.ts";

const port = process.argv[2] ?? "4346";
const inner = String(Number(port) + 1);
const app = Bun.spawn(["bun", "proof/serve-graph-flows.ts", inner], {
	stdout: "inherit",
	stderr: "inherit",
});
const base = `http://127.0.0.1:${inner}`;
for (let tries = 0; tries < 200; tries += 1) {
	const ready = await fetch(base).then(
		() => true,
		() => false,
	);
	if (ready) {
		break;
	}
	await Bun.sleep(100);
}

const frames = {
	closed: "/projects/acme%2Fwidget",
	open: "/projects/acme%2Fwidget?ticket=acme%2Fwidget%233",
};

// The walk runner pins one desktop viewport, so each frame gives the
// project page a phone-width viewport of its own.
const phonePage = `<!doctype html>
<meta charset="utf-8">
<title>Phone width</title>
<style>body{display:flex;gap:16px;margin:8px;font:14px sans-serif}iframe{width:390px;height:760px;border:1px solid #888}</style>
${Object.entries(frames)
	.map(
		([name, path]) =>
			`<figure><figcaption>panel ${name}: <span id="layout-${name}">waiting</span></figcaption><iframe id="frame-${name}" src="${path}"></iframe></figure>`,
	)
	.join("")}
<script>
setInterval(() => {
	for (const name of ${JSON.stringify(Object.keys(frames))}) {
		const doc = document.getElementById("frame-" + name).contentDocument;
		const layout = doc?.getElementById("project-graph-layout")?.textContent;
		const panel = doc?.querySelector("[aria-label='Expand panel']") ? " panel-collapsed" : "";
		document.getElementById("layout-" + name).textContent = (layout || "waiting") + panel;
	}
}, 200);
</script>`;

Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/phone") {
			return new Response(phonePage, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		const target = new URL(`${url.pathname}${url.search}`, base);
		const response = await fetch(
			new Request(target, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			}),
		);
		return proofTheme(response);
	},
});
console.log(`http://127.0.0.1:${port}/`);
await proofStops();
app.kill();
process.exit(0);
