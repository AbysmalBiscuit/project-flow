import { serveProxy } from "./serve-proxy.ts";

const project = "Initial SDI Issues";

// The page frames the project table and lists each row with its depth and,
// for a parent ticket, whether its sub-tickets show.
const rowsPage = `<!doctype html>
<meta charset="utf-8">
<title>Table rows</title>
<style>body{margin:8px;font:14px sans-serif}iframe{width:100%;height:calc(100vh - 48px);border:1px solid #888}</style>
<p id="rows">waiting</p>
<iframe id="frame" src="/projects/${encodeURIComponent(project)}"></iframe>
<script>
setInterval(() => {
	const doc = document.getElementById("frame").contentDocument;
	const rows = [...(doc?.querySelectorAll("tr[data-ticket]") ?? [])];
	if (rows.length === 0) return;
	document.getElementById("rows").textContent = "Rows: " + rows.map((row) => {
		const toggle = row.querySelector("[data-toggle]");
		const mark = toggle === null ? "" : toggle.getAttribute("aria-expanded") === "true" ? " open" : " shut";
		return row.dataset.ticket + " depth " + row.dataset.depth + mark;
	}).join(", ");
}, 200);
</script>`;

await serveProxy(process.argv[2] ?? "4353", "proof/serve-353-app.ts", (url) =>
	url.pathname === "/rows"
		? new Response(rowsPage, {
				headers: { "content-type": "text/html; charset=utf-8" },
			})
		: null,
);
