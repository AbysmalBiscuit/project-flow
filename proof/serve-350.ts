import { serveProxy } from "./serve-proxy.ts";

const parent = "AbysmalBiscuit/project-flow#97";

// The page frames the project graph and names each group box that holds
// the #97 card, with the count of other cards in that box.
const checkPage = `<!doctype html>
<meta charset="utf-8">
<title>Parent group</title>
<style>body{margin:8px;font:14px sans-serif}iframe{width:100%;height:calc(100vh - 48px);border:1px solid #888}</style>
<p id="placed">waiting</p>
<iframe id="frame" src="/projects/AbysmalBiscuit%2Fproject-flow"></iframe>
<script>
const inside = (outer, inner) =>
	inner.left >= outer.left && inner.right <= outer.right &&
	inner.top >= outer.top && inner.bottom <= outer.bottom;
setInterval(() => {
	const doc = document.getElementById("frame").contentDocument;
	const card = doc?.querySelector(${JSON.stringify(`[data-graph-node='${parent}']`)});
	if (!card) return;
	const box = card.getBoundingClientRect();
	const cards = [...doc.querySelectorAll("[data-graph-node]")];
	const groups = [...doc.querySelectorAll("[data-group]")].flatMap((group) => {
		const area = group.getBoundingClientRect();
		if (!inside(area, box)) return [];
		const others = cards.filter((other) => other !== card && inside(area, other.getBoundingClientRect())).length;
		return [group.dataset.group + " with " + others + " other cards"];
	});
	document.getElementById("placed").textContent =
		"#97 inside: " + (groups.length === 0 ? "no group" : groups.join(" | "));
}, 200);
</script>`;

await serveProxy(process.argv[2] ?? "4750", "proof/serve-350-app.ts", (url) =>
	url.pathname === "/check"
		? new Response(checkPage, {
				headers: { "content-type": "text/html; charset=utf-8" },
			})
		: null,
);
