/**
 * Serves the recorded tickets of `serve-415.ts` with walk helpers for the open ticket in the URL.
 *
 * `#walk-back` runs `history.back()` and `#walk-reload` reloads the page.
 * `#walk-url` names how the page loaded, the decoded page URL, and the
 * selected table row or pressed graph card.
 * Usage: `bun proof/serve-394.ts [PORT]`.
 */
import { serveProxy } from "./serve-proxy.ts";

const historyScript = `<p style="position:fixed;left:0;bottom:0;margin:0;z-index:2147483647;background:Canvas;color:CanvasText;font:12px monospace"><button type="button" id="walk-back" onclick="history.back()">Back</button> <button type="button" id="walk-reload" onclick="location.reload()">Reload</button> <span id="walk-url"></span></p><script id="walk-url-check">(function () {
	var out = document.getElementById("walk-url");
	var load = performance.getEntriesByType("navigation")[0];
	setInterval(function () {
		var picked = document.querySelector("tr[data-selected=true], [data-graph-node][aria-pressed=true]");
		var name = picked === null ? "none" : picked.getAttribute("data-ticket") || picked.getAttribute("data-graph-node");
		out.textContent = (load === undefined ? "load" : load.type) + " | URL " + decodeURIComponent(location.pathname + location.search) + " | selected " + name;
	}, 100);
})();</script>`;

await serveProxy(process.argv[2] ?? "4394", "proof/serve-415.ts", () => null, {
	inject: historyScript,
});
