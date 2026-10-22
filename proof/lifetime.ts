import { type RunIo, run, waitForStop } from "../src/main.ts";

/** A proof server exits after this long when nobody stops it. */
export const proofServerLifetimeMs = 30 * 60 * 1000;

const parentPollMs = 1_000;

/** Caller cleanup after a stop; a stall still ends the process. */
const shutdownGraceMs = 5_000;

function lifetimeMs(): number {
	const override = process.env.PROJECT_FLOW_PROOF_LIFETIME_MS;
	if (override === undefined || override.trim() === "") {
		return proofServerLifetimeMs;
	}
	if (!/^\d+(\.\d+)?$/.test(override.trim())) {
		throw new Error(
			"PROJECT_FLOW_PROOF_LIFETIME_MS needs a non-negative number of milliseconds",
		);
	}
	return Number(override);
}

function parentStillRuns(parent: number): boolean {
	return process.ppid === parent;
}

let stops: Promise<void> | undefined;

export function proofStops(): Promise<void> {
	stops ??= watchProof();
	return stops;
}

function watchProof(): Promise<void> {
	const lifetime = lifetimeMs();
	const parent = process.ppid;
	const stopsHere = new Promise<void>((resolve) => {
		const stop = () => {
			clearInterval(watch);
			clearTimeout(timer);
			resolve();
		};
		void waitForStop().then(stop);
		const timer = setTimeout(stop, lifetime);
		timer.unref();
		const watch = setInterval(() => {
			if (parentStillRuns(parent)) {
				return;
			}
			stop();
		}, parentPollMs);
		watch.unref();
	});
	void stopsHere.then(() => {
		const force = setTimeout(() => {
			process.exit(1);
		}, shutdownGraceMs);
		force.unref();
	});
	return stopsHere;
}

const walkMarker = "data-walk-theme";

const walkScript = `<script id="walk-theme">(function () {
	var name = "Theme";
	function paint() {
		var root = document.documentElement;
		var theme = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
		var line = document.getElementById("walk-theme-name");
		if (line === null) {
			line = document.createElement("p");
			line.id = "walk-theme-name";
			document.body.prepend(line);
		}
		line.textContent = name + " " + theme;
		line.style.position = "fixed";
		line.style.top = "0";
		line.style.left = "0";
		line.style.zIndex = "2147483647";
	}
	new MutationObserver(paint).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	function markFocus() {
		var active = document.activeElement;
		var nodes = document.querySelectorAll("[data-walk-focus]");
		for (var i = 0; i < nodes.length; i++) {
			nodes[i].removeAttribute("data-walk-focus");
		}
		if (active && active !== document.body && active.id !== "walk-esc" && active.id !== "walk-ctrl") {
			var card = active.closest("li") || active.closest("tr") || active;
			card.setAttribute("data-walk-focus", "");
			card.scrollIntoView({ block: "center", inline: "nearest" });
		}
	}
	document.addEventListener("focusin", markFocus, true);
	document.addEventListener("keyup", markFocus, true);
	document.addEventListener("keydown", function () {
		setTimeout(markFocus, 50);
	}, true);
	if (document.body) {
		paint();
		markFocus();
	} else {
		document.addEventListener("DOMContentLoaded", function () {
			paint();
			markFocus();
		});
	}
})();</script><style id="walk-focus">[data-walk-focus]{outline:3px solid #e5484d !important;outline-offset:-3px !important;box-shadow:inset 0 0 0 3px #e5484d !important}</style><button type="button" id="walk-ctrl-k" hidden></button><input type="text" id="walk-esc" tabindex="-1" aria-label="Escape" style="position:fixed;right:0;bottom:0;opacity:0"><input type="text" id="walk-ctrl" tabindex="-1" aria-label="Control" style="position:fixed;right:0;bottom:0;opacity:0"><script id="walk-keys">(function () {
	var opener = document.getElementById("walk-ctrl-k");
	if (opener) {
		opener.addEventListener("click", function () {
			window.dispatchEvent(new KeyboardEvent("keydown", {
				key: "k",
				code: "KeyK",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}));
		});
	}
	var walkCtrl = document.getElementById("walk-ctrl");
	var ctrlNext = false;
	if (walkCtrl) {
		walkCtrl.addEventListener("input", function () {
			if (walkCtrl.value !== "") {
				ctrlNext = true;
			}
			walkCtrl.value = "";
		});
		var pressed = null;
		document.addEventListener("mousedown", function (event) {
			pressed = event.target;
		}, true);
		document.addEventListener("click", function (event) {
			if (!ctrlNext || !event.isTrusted) {
				return;
			}
			ctrlNext = false;
			event.preventDefault();
			event.stopImmediatePropagation();
			var target = pressed !== null && pressed.isConnected ? pressed : event.target;
			target.dispatchEvent(new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				clientX: event.clientX,
				clientY: event.clientY,
				ctrlKey: true,
			}));
		}, true);
	}
	var walkEsc = document.getElementById("walk-esc");
	if (!walkEsc) {
		return;
	}
	var seen = "";
	var reply = null;
	walkEsc.addEventListener("focusin", function (event) {
		var prior = event.relatedTarget;
		if (prior instanceof HTMLElement && prior.id === "ticket-reply") {
			reply = prior;
			return;
		}
		reply = null;
	});
	walkEsc.addEventListener("input", function () {
		var before = document.activeElement;
		var stamp = walkEsc.value;
		walkEsc.value = "";
		if (stamp === "" || stamp === seen) {
			return;
		}
		seen = stamp;
		if (reply !== null && reply.isConnected) {
			reply.focus();
		}
		var event = new KeyboardEvent("keydown", {
			key: "Escape",
			code: "Escape",
			ctrlKey: stamp.indexOf("ctrl") === 0,
			bubbles: true,
			cancelable: true,
		});
		var target = reply !== null && reply.isConnected ? reply : document.body;
		target.dispatchEvent(event);
		reply = null;
	});
})();</script>`;

/** Publish the root data-theme value as text a walk can assert. */
export async function proofTheme(response: Response): Promise<Response> {
	const type = response.headers.get("content-type") ?? "";
	if (!type.includes("text/html")) {
		return response;
	}
	const html = await response.text();
	if (html.includes(walkMarker)) {
		return new Response(html, response);
	}
	const stamped = html.includes("</body>")
		? html.replace("</body>", `${walkScript}</body>`)
		: `${html}${walkScript}`;
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return new Response(stamped, { status: response.status, headers });
}

export async function serveProof(args: string[], io: RunIo): Promise<never> {
	const result = await run(args, { ...io, waitForStop: proofStops() });
	process.exit(result.exitCode);
}
