import { proofStops } from "./lifetime.ts";

// Holding the first save lets a second quick save reach the app first.
// The status line reports a result only after the counts stop changing.
const port = process.argv[2] ?? "4397";
const inner = String(Number(port) + 1);
const base = `http://127.0.0.1:${inner}`;
const firstSaveHoldMs = 2_000;

let saves = 0;
let answered = 0;
let projectReads = 0;

const app = Bun.spawn(["bun", "proof/serve-397-app.ts", inner], {
	stdout: "inherit",
	stderr: "inherit",
});
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

const statusScript = `<div id="proof-status" style="position:fixed;left:8px;bottom:8px;z-index:99;padding:6px 10px;background:#fff;color:#000;border:1px solid #000;font:13px monospace"></div>
<script>
let last = "";
let quietSince = Date.now();
let projectSince = null;
setInterval(async () => {
	const state = await (await fetch("/proof/state")).json();
	const seen = JSON.stringify(state);
	if (seen !== last) {
		last = seen;
		quietSince = Date.now();
	}
	const quiet = Date.now() - quietSince > 1500;
	const onProject = location.pathname.startsWith("/projects/");
	projectSince = onProject ? (projectSince ?? Date.now()) : null;
	const button = document.querySelector("#overview-sort")?.textContent?.trim() ?? "none";
	const lines = ["saves sent " + state.saves + ", answered " + state.answered];
	if (quiet && state.answered >= 2) {
		lines.push("after both saves: sort button " + button + ", saved sort " + state.savedSort);
	}
	if (quiet && state.answered >= 1 && onProject && Date.now() - projectSince > 1500) {
		lines.push("project reads since the sort change: " + state.projectReads);
	}
	document.getElementById("proof-status").textContent = lines.join(" | ");
}, 200);
</script>`;

async function savedSort(): Promise<string> {
	const body = (await (await fetch(`${base}/api/settings`)).json()) as {
		overview?: { sort?: string };
	};
	return body.overview?.sort ?? "none";
}

async function forward(request: Request, url: URL): Promise<Response> {
	const body =
		request.method === "GET" || request.method === "HEAD"
			? null
			: await request.text();
	const save = request.method === "PUT" && url.pathname === "/api/settings";
	if (save) {
		saves += 1;
		if (saves === 1) {
			await Bun.sleep(firstSaveHoldMs);
		}
	}
	if (saves > 0 && url.pathname.startsWith("/api/projects/")) {
		projectReads += 1;
	}
	const response = await fetch(new URL(`${url.pathname}${url.search}`, base), {
		method: request.method,
		headers: request.headers,
		body,
	});
	if (save) {
		answered += 1;
	}
	return response;
}

Bun.serve({
	hostname: "127.0.0.1",
	port,
	idleTimeout: 0,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/proof/state") {
			return Response.json({
				saves,
				answered,
				projectReads,
				savedSort: await savedSort(),
			});
		}
		const response = await forward(request, url);
		if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
			return response;
		}
		const headers = new Headers(response.headers);
		headers.delete("content-length");
		const page = await response.text();
		return new Response(page.replace("</body>", `${statusScript}</body>`), {
			status: response.status,
			headers,
		});
	},
});
console.log(`http://127.0.0.1:${port}/`);
await proofStops();
app.kill();
process.exit(0);
