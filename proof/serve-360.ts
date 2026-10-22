import variants from "./button-variants.html";
import { serveProxy } from "./serve-proxy.ts";

// Publishes the panel header buttons' names, tooltips and heights as text.
const headerScript = `<p id="walk-360" style="position:fixed;left:0;top:0;margin:0;z-index:2147483647;background:#fff;font:12px monospace"></p><script>
function iconOf(node) {
	var svg = node.querySelector("svg");
	var names = svg ? svg.getAttribute("class").split(" ") : [];
	return names.filter(function (name) {
		return name.indexOf("lucide-") === 0;
	})[0] || "none";
}
setInterval(function () {
	var out = document.getElementById("walk-360");
	var aside = document.querySelector("aside[data-panel]");
	var head = aside && aside.firstElementChild;
	if (!head) {
		out.textContent = "panel waiting";
		return;
	}
	var items = Array.prototype.slice.call(head.querySelectorAll("a, button"));
	var heights = items.map(function (node) {
		return node.getBoundingClientRect().height;
	});
	var equal = items.length === 3 && heights.every(function (h) {
		return h === heights[0];
	});
	out.textContent =
		"panel " + (aside.dataset.expanded === "true" ? "expanded" : "collapsed") +
		" | " +
		items.map(function (node, index) {
			return (node.textContent.trim() || "icon") +
				" name=" + node.getAttribute("aria-label") +
				" tooltip=" + node.getAttribute("title") +
				" icon=" + iconOf(node) +
				" h=" + heights[index];
		}).join(" | ") +
		(equal ? " | heights equal " + heights[0] : " | heights differ");
}, 200);
</script>`;

await serveProxy(
	process.argv[2] ?? "4360",
	"proof/serve-graph-flows.ts",
	() => null,
	{ pages: { "/variants": variants }, inject: headerScript },
);
