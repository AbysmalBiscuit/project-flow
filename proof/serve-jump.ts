import { createServer } from "node:net";
import type { Fetch } from "../src/fetch.ts";
import {
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const board = "acme/board";
const gate = "acme/gate";

function issue(
	number: number,
	title: string,
	repo: string,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-18T12:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

const boardIssues = [
	issue(12, "Ship the widget", board),
	issue(3, "Hold the launch", board),
	issue(
		44,
		"project-flow ticket search keeps a very long title inside the box without a sideways scroll bar",
		board,
	),
];
const gateIssues = [issue(9, "Open the gate", gate)];

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const listed = repoReadFromLists(input, init, {
		[board]: boardIssues,
		[gate]: gateIssues,
	});
	if (listed !== null) {
		return listed;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith(`https://api.github.com/repos/${board}/issues?`)) {
		return Response.json(boardIssues);
	}
	if (url.startsWith(`https://api.github.com/repos/${gate}/issues?`)) {
		return Response.json(gateIssues);
	}
	if (url === `https://api.github.com/repos/${board}/issues/12`) {
		return Response.json({
			title: "Ship the widget",
			html_url: `https://github.com/${board}/issues/12`,
		});
	}
	if (url.includes("/issues/12/comments")) {
		return Response.json([
			{
				id: 1,
				body: "Ready for the jump",
				created_at: "2026-10-18T12:00:00Z",
				user: { login: "lev" },
			},
		]);
	}
	if (emptyLists(url)) {
		return Response.json([]);
	}
	return emptyLinear(url) ?? unrecorded(input);
};

const publicPort = Number(process.env.PORT ?? process.argv[2] ?? "4188");
const appPort = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once("error", reject);
	probe.listen(0, "127.0.0.1", () => {
		const address = probe.address();
		if (address === null || typeof address === "string") {
			reject(new Error("jump proof has no app port"));
			return;
		}
		const chosen = address.port;
		probe.close(() => resolve(chosen));
	});
});

function fitPage(): string {
	return `<!doctype html>
<meta charset="utf-8">
<title>Search fit</title>
<pre id="search-fit" style="position:fixed;left:8px;bottom:8px;z-index:2147483647;margin:0;padding:8px;background:#fff;color:#111">measuring</pre>
<script>
const widths = [1280, 390];
const lines = [];
let pending = widths.length;
const host = document.querySelector("#search-fit");
function line(label, width, node) {
  if (node === null) {
    return label + " " + width + " scrollWidth 0 clientWidth 0 overflows";
  }
  const fit = node.scrollWidth <= node.clientWidth ? "fits" : "overflows";
  return label + " " + width + " scrollWidth " + node.scrollWidth + " clientWidth " + node.clientWidth + " " + fit;
}
for (const width of widths) {
  const frame = document.createElement("iframe");
  frame.setAttribute("style", "position:fixed;left:0;top:0;border:0;width:" + width + "px;height:640px");
  frame.src = "/?proof-fit=1&width=" + width;
  frame.addEventListener("load", () => {
    setTimeout(() => {
      const child = frame.contentDocument;
      const dialog = child === null ? null : child.querySelector("[role='dialog']");
      const list = dialog === null ? null : dialog.querySelector("ul");
      lines.push(line("dialog", width, dialog), line("list", width, list));
      pending -= 1;
      if (pending === 0 && host !== null) {
        host.textContent = lines.join("\\n");
      }
    }, 900);
  });
  document.body.append(frame);
}
</script>`;
}

const openScript = `<script>
const longQuery = "project-flow ticket search keeps a very long title inside the box";
window.setTimeout(() => {
  document.querySelector("#header-search")?.click();
  window.setTimeout(() => {
    const query = document.querySelector("#jump-query");
    if (!(query instanceof HTMLInputElement)) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(query, longQuery);
    query.dispatchEvent(new Event("input", { bubbles: true }));
  }, 50);
}, 50);
</script>`;

void serveRecorded({
	prefix: "project-flow-jump-",
	port: String(appPort),
	config: {
		pinned: [
			{ tracker: "github", repo: board },
			{ tracker: "github", repo: gate },
		],
		checkoutRoots: [],
	},
	fetch: recorded,
});

const appReady = `http://127.0.0.1:${appPort}/`;
let appUp = false;
for (let attempt = 0; attempt < 50 && !appUp; attempt += 1) {
	try {
		const probe = await fetch(appReady);
		await probe.body?.cancel();
		appUp = probe.ok;
	} catch {
		await Bun.sleep(100);
	}
}
if (!appUp) {
	throw new Error("jump proof app did not listen");
}

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

Bun.serve({
	hostname: "127.0.0.1",
	port: publicPort,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/proof/search-fit") {
			return new Response(fitPage(), {
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
			`http://127.0.0.1:${appPort}${url.pathname}${url.search}`,
			init,
		);
		if (url.searchParams.get("proof-fit") !== "1") {
			return upstream;
		}
		const html = (await upstream.text()).replace(
			"</body>",
			`${openScript}</body>`,
		);
		const headers = new Headers(upstream.headers);
		headers.delete("content-length");
		return new Response(html, { status: upstream.status, headers });
	},
});
