import { createServer } from "node:net";
import { proofStops } from "./lifetime.ts";

const portText = process.argv[2] ?? "47387";
const publicPort = Number(portText);
if (!/^\d+$/.test(portText) || publicPort < 1 || publicPort > 65535) {
	console.error("show-all proof needs a port from 1 to 65535");
	process.exit(1);
}
const phone = process.argv[3] === "390";
const frameWidth = phone ? 390 : 1280;

const appPort = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once("error", reject);
	probe.listen(0, "127.0.0.1", () => {
		const address = probe.address();
		if (address === null || typeof address === "string") {
			reject(new Error("show-all proof has no app port"));
			return;
		}
		const chosen = address.port;
		probe.close(() => resolve(chosen));
	});
});

const child = Bun.spawn(["bun", "proof/serve-card-lanes.ts", String(appPort)], {
	stdout: "inherit",
	stderr: "inherit",
});
const stops = proofStops();
void stops.then(() => {
	child.kill("SIGTERM");
});

function copyHeaders(source: Headers): Headers {
	const headers = new Headers();
	for (const [name, value] of source) {
		if (
			name.toLowerCase() === "host" ||
			name.toLowerCase() === "content-length"
		) {
			continue;
		}
		headers.append(name, value);
	}
	return headers;
}

function phonePage(src: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Done lane at ${String(frameWidth)}</title>
</head>
<body>
<p id="show-all-probe">header waiting</p>
<iframe id="phone-frame" title="Board at ${String(frameWidth)}" src="${src}" style="width:${String(frameWidth)}px;height:844px;border:0"></iframe>
<script>
const frame = document.getElementById("phone-frame");
const host = document.getElementById("show-all-probe");
const read = () => {
	const doc = frame.contentDocument;
	if (doc === null || host === null) return;
	const frameButton = doc.getElementById("card-lane-frame");
	if (frameButton !== null && frameButton.textContent !== "lanes framed") {
		frameButton.click();
	}
	const lane = doc.querySelector("[data-lane='Done']");
	const title = lane === null ? null : lane.querySelector("h2");
	const button = doc.querySelector("[data-show-all='Done']");
	if (lane === null || title === null) return;
	const laneBox = lane.getBoundingClientRect();
	const titleBox = title.getBoundingClientRect();
	const oneLine = title.scrollHeight <= title.clientHeight + 1
		&& title.getClientRects().length === 1;
	const inHeader = button !== null
		&& Math.abs(button.getBoundingClientRect().top - titleBox.top) <= titleBox.height;
	const below = button !== null
		&& button.getBoundingClientRect().top >= laneBox.top + laneBox.height * 0.6;
	const parts = [
		"lane Done",
		"title " + (title.textContent ?? "").trim().replace(/\\s+/g, " "),
		oneLine ? "title one line" : "title wrapped",
		button !== null ? "show all visible" : "show all hidden",
		inHeader ? "show all in header" : "show all not in header",
		below ? "show all at foot" : "show all not at foot",
		"scrollWidth " + doc.documentElement.scrollWidth,
	];
	const next = parts.join(" ");
	if (host.textContent !== next) host.textContent = next;
};
const start = () => {
	const doc = frame.contentDocument;
	if (doc === null || doc.documentElement === null) return;
	if (frame.dataset.watched === "yes") {
		read();
		return;
	}
	frame.dataset.watched = "yes";
	const watch = new MutationObserver(read);
	watch.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
	read();
};
frame.addEventListener("load", start);
setInterval(start, 200);
</script>
</body>
</html>`;
}

Bun.serve({
	hostname: "127.0.0.1",
	port: publicPort,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/") {
			return new Response("show all proof", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}
		if (phone && url.pathname === "/proof/show-all-390") {
			const src = `/projects/Widget%20board?frame=acme/widget%2310`;
			return new Response(phonePage(src), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		const init: RequestInit = {
			method: request.method,
			headers: copyHeaders(request.headers),
		};
		if (request.method !== "GET" && request.method !== "HEAD") {
			init.body = request.body;
		}
		const upstream = await fetch(
			`http://127.0.0.1:${String(appPort)}${url.pathname}${url.search}`,
			init,
		);
		return upstream;
	},
});
