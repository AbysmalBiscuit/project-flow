import variants from "./button-variants.html";
import { proofStops, proofTheme } from "./lifetime.ts";

const port = process.argv[2] ?? "4360";
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

Bun.serve({
	hostname: "127.0.0.1",
	port,
	development: false,
	routes: { "/variants": variants },
	async fetch(request) {
		const url = new URL(request.url);
		const response = await proofTheme(
			await fetch(
				new Request(new URL(`${url.pathname}${url.search}`, base), {
					method: request.method,
					headers: request.headers,
					body: request.body,
				}),
			),
		);
		if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
			return response;
		}
		const page = await response.text();
		const headers = new Headers(response.headers);
		headers.delete("content-length");
		return new Response(page.replace("</body>", `${headerScript}</body>`), {
			status: response.status,
			headers,
		});
	},
});
console.log(`http://127.0.0.1:${port}/`);
await proofStops();
app.kill();
process.exit(0);
