/**
 * Serves the chain group graph with a walk helper that checks the frames.
 *
 * Type a label into `#walk-frames`. When the graph stops moving,
 * `#walk-frames-out` names each card that crosses the edge of a frame.
 * Usage: `bun proof/serve-369.ts [PORT]`.
 */
import { serveProxy } from "./serve-proxy.ts";

const framesScript = `<input type="text" id="walk-frames" tabindex="-1" aria-label="Frames" style="position:fixed;right:0;bottom:0;opacity:0"><p id="walk-frames-out" style="position:fixed;top:1.5em;right:0;margin:0;z-index:2147483647"></p><script id="walk-frames-check">(function () {
	var input = document.getElementById("walk-frames");
	function boxes() {
		var nodes = document.querySelectorAll("#project-graph .react-flow__node");
		var text = "";
		for (var i = 0; i < nodes.length; i++) {
			var box = nodes[i].getBoundingClientRect();
			text += nodes[i].getAttribute("data-id") + box.left + "," + box.top + "," + box.width + "," + box.height + ";";
		}
		return text;
	}
	input.addEventListener("input", function () {
		var label = input.value;
		input.value = "";
		if (label === "") {
			return;
		}
		var last = "";
		var still = 0;
		var watch = setInterval(function () {
			var now = boxes();
			still = now === last ? still + 1 : 0;
			last = now;
			if (still >= 5) {
				clearInterval(watch);
				check(label);
			}
		}, 200);
	});
	function check(label) {
		var pressed = document.querySelectorAll("[aria-pressed=true][id^=graph-layout-], [aria-pressed=true][id^=graph-direction-]");
		var shown = [];
		for (var p = 0; p < pressed.length; p++) {
			shown.push(pressed[p].id.replace("graph-layout-", "").replace("graph-direction-", ""));
		}
		var frames = document.querySelectorAll("#project-graph .react-flow__node-cluster");
		var cards = document.querySelectorAll("#project-graph .react-flow__node-ticket");
		var crossing = [];
		var held = 0;
		for (var c = 0; c < cards.length; c++) {
			var card = cards[c].getBoundingClientRect();
			var inside = false;
			for (var f = 0; f < frames.length; f++) {
				var frame = frames[f].getBoundingClientRect();
				var meets = card.left < frame.right && frame.left < card.right && card.top < frame.bottom && frame.top < card.bottom;
				if (!meets) {
					continue;
				}
				var within = card.left >= frame.left - 0.5 && card.right <= frame.right + 0.5 && card.top >= frame.top - 0.5 && card.bottom <= frame.bottom + 0.5;
				if (within) {
					inside = true;
					continue;
				}
				crossing.push(cards[c].getAttribute("data-id") + " crosses " + frames[f].getAttribute("data-id") + " by " + Math.round(Math.max(frame.left - card.left, card.right - frame.right, frame.top - card.top, card.bottom - frame.bottom)) + "px");
			}
			if (inside) {
				held += 1;
			}
		}
		document.getElementById("walk-frames-out").textContent = label + " (" + shown.join(" ") + "): " + held + " of " + cards.length + " cards framed, " + frames.length + " frames, " + (crossing.length === 0 ? "none cross" : crossing.length + " cross: " + crossing.join("; "));
	}
})();</script>`;

await serveProxy(
	process.argv[2] ?? "4369",
	"proof/serve-chain-group.ts",
	() => null,
	{ inject: framesScript },
);
