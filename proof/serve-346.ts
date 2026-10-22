import { serveProxy } from "./serve-proxy.ts";

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

await serveProxy(
	process.argv[2] ?? "4346",
	"proof/serve-graph-flows.ts",
	(url) =>
		url.pathname === "/phone"
			? new Response(phonePage, {
					headers: { "content-type": "text/html; charset=utf-8" },
				})
			: null,
);
