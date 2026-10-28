import type { Fetch } from "../src/fetch.ts";
import { urlOf } from "../test/support/fetch.ts";
import { recordedDiscovery } from "../test/support/github.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";
import { freePort } from "./serve-proxy.ts";

const repo = "acme/widget";
const cardCount = 24;
const lastTitle = "Last backlog card sits below the fold";

const labels = [
	{ name: "ready", color: "d0d7de" },
	{ name: "factory: running", color: "f0c674" },
	{ name: "factory: in-review", color: "9ecbff" },
];

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const end = { hasNextPage: false, endCursor: null };

function recordedIssue(
	number: number,
	title: string,
	issueLabels: string[],
	state: "OPEN" | "CLOSED" = "OPEN",
) {
	return {
		number,
		title,
		state,
		stateReason: state === "CLOSED" ? "COMPLETED" : null,
		updatedAt: "2026-10-18T12:00:00Z",
		createdAt: "2026-10-01T00:00:00Z",
		closedAt: state === "CLOSED" ? "2026-10-18T12:00:00Z" : null,
		body: "",
		comments: { nodes: [], pageInfo: end },
		labels: {
			nodes: issueLabels.map((name) => ({ name, color: "d0d7de" })),
			pageInfo: end,
		},
		assignees: { nodes: [] },
		milestone: null,
		parent: null,
		blockedBy: { nodes: [], pageInfo: end },
		blocking: { nodes: [], pageInfo: end },
	};
}

const issues = [
	...Array.from({ length: cardCount }, (_, index) =>
		recordedIssue(
			index + 1,
			index + 1 === cardCount
				? lastTitle
				: `Backlog card ${String(index + 1)} fills the lane`,
			["ready"],
		),
	),
	recordedIssue(101, "Hold the launch window open", ["factory: running"]),
	recordedIssue(102, "Read the review comments twice", ["factory: in-review"]),
	recordedIssue(
		103,
		"Merge the board after the last review round",
		[],
		"CLOSED",
	),
];

function recordedRepo(): Response {
	return Response.json({
		data: {
			repository: {
				nameWithOwner: repo,
				autoMergeAllowed: false,
				refs: { nodes: [], pageInfo: end },
				labels: {
					nodes: labels,
					pageInfo: end,
				},
				issues: { nodes: issues, pageInfo: end },
				openPullRequests: { nodes: [], pageInfo: end },
				mergedPullRequests: { nodes: [], pageInfo: end },
			},
		},
	});
}

function restIssue(item: ReturnType<typeof recordedIssue>) {
	return {
		number: item.number,
		title: item.title,
		state: item.state === "CLOSED" ? "closed" : "open",
		state_reason: item.stateReason === "COMPLETED" ? "completed" : null,
		updated_at: item.updatedAt,
		closed_at: item.closedAt,
		body: "",
		html_url: `https://github.com/${repo}/issues/${String(item.number)}`,
		comments: 0,
		labels: item.labels.nodes,
		assignee: null,
		milestone: null,
	};
}

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	const linear = emptyLinear(url);
	if (linear !== null) {
		return linear;
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page(issues.map(restIssue));
	}
	if (url.includes("/labels?")) {
		return page(labels);
	}
	if (emptyLists(url) || url.includes("/dependencies/")) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("RepoRead")) {
			return recordedRepo();
		}
		return Response.json({
			data: {
				repository: {
					nameWithOwner: repo,
					autoMergeAllowed: false,
				},
			},
		});
	}
	return unrecorded(input);
};

const publicPort = Number(process.env.PORT ?? process.argv[2] ?? "4196");
const appPort = await freePort();

void serveRecorded({
	prefix: "project-flow-lane-scroll-",
	port: String(appPort),
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "dark",
		projectViews: {
			[repo]: { openView: "board", groupBy: "none" },
		},
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
	throw new Error("lane scroll proof app did not listen");
}

const probeScript = `<script>
const hostId = "lane-scroll-probe";
const ensure = () => {
  let host = document.querySelector("#" + hostId);
  if (host === null) {
    host = document.createElement("pre");
    host.id = hostId;
    host.setAttribute("style", "position:fixed;left:8px;top:8px;z-index:2147483646;margin:0;padding:8px;background:#fff;color:#111;max-width:70vw");
    host.textContent = "lane scroll probe";
    document.body.append(host);
  }
  return host;
};
const write = (text) => {
  const host = ensure();
  host.textContent = text;
};
const pageFit = () => {
  const page = document.documentElement;
  const equal = page.scrollWidth === page.clientWidth;
  return "page scrollWidth " + page.scrollWidth + " clientWidth " + page.clientWidth + (equal ? " equal" : " wider");
};
const laneState = () => {
  const body = document.querySelector("[data-lane-cards='ready']");
  const last = document.querySelector("[data-ticket='acme/widget#24']");
  const lane = document.querySelector("[data-lane='ready']");
  const title = lane === null ? null : lane.querySelector("h2");
  const board = document.querySelector("[data-lanes]");
  if (body === null || last === null || title === null || board === null) {
    return "lane missing";
  }
  const lastBox = last.getBoundingClientRect();
  const bodyBox = body.getBoundingClientRect();
  const titleBox = title.getBoundingClientRect();
  const lastInside = lastBox.top >= bodyBox.top - 1 && lastBox.bottom <= bodyBox.bottom + 1;
  const titleHeld = bodyBox.top >= titleBox.bottom - 1 && titleBox.bottom > 0;
  const reached = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
  return [
    "lane scrollTop " + Math.round(body.scrollTop),
    reached ? "reached" : "short",
    lastInside ? "last card inside" : "last card outside",
    titleHeld ? "title held" : "title lost",
    "board scrollWidth " + board.scrollWidth + " clientWidth " + board.clientWidth,
    "board scrollLeft " + Math.round(board.scrollLeft),
    pageFit(),
  ].join(" ");
};
const scrollLane = () => {
  const body = document.querySelector("[data-lane-cards='ready']");
  if (body === null) {
    write("lane missing");
    return;
  }
  body.scrollTop = body.scrollHeight;
  write(laneState());
};
const scrollBoard = (left) => {
  const board = document.querySelector("[data-lanes]");
  if (board === null) {
    write("board missing");
    return;
  }
  board.scrollLeft = left;
  write(laneState());
};
let settled = false;
window.setInterval(() => {
  if (settled) {
    return;
  }
  const text = laneState();
  write(text);
  if (!text.includes("missing")) {
    settled = true;
  }
}, 200);
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const action = target.closest("[data-lane-proof]");
  if (action === null) {
    return;
  }
  const name = action.getAttribute("data-lane-proof");
  if (name === "scroll-lane") {
    scrollLane();
  }
  if (name === "scroll-board") {
    scrollBoard(200);
  }
});
const bar = document.createElement("div");
bar.setAttribute("style", "position:fixed;right:8px;top:8px;z-index:2147483647;display:flex;gap:8px");
for (const item of [
  ["scroll-lane", "Scroll lane"],
  ["scroll-board", "Scroll board"],
]) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-lane-proof", item[0]);
  button.textContent = item[1];
  bar.append(button);
}
document.addEventListener("DOMContentLoaded", () => {
  document.body.append(bar);
  write(laneState());
});
</script>`;

function framedBoard(width: number, scrollLeft: number): string {
	return `<!doctype html>
<meta charset="utf-8">
<title>Lane scroll at ${String(width)}</title>
<pre id="lane-scroll-probe" style="position:fixed;left:8px;bottom:8px;z-index:2147483647;margin:0;padding:8px;background:#fff;color:#111">measuring</pre>
<script>
const host = document.querySelector("#lane-scroll-probe");
const frame = document.createElement("iframe");
frame.setAttribute("style", "position:fixed;left:0;top:0;border:0;width:${String(width)}px;height:800px");
frame.src = "/projects/acme%2Fwidget";
frame.addEventListener("load", () => {
  window.setTimeout(() => {
    const child = frame.contentDocument;
    if (child === null || host === null) {
      return;
    }
    const page = child.documentElement;
    const board = child.querySelector("[data-lanes]");
    const equal = page.scrollWidth === page.clientWidth;
    const wider = board !== null && board.scrollWidth > board.clientWidth;
    const before = board === null ? 0 : board.scrollLeft;
    if (board !== null) {
      board.scrollLeft = ${String(scrollLeft)};
    }
    const moved = board !== null && board.scrollLeft > before;
    host.textContent = [
      "page scrollWidth " + page.scrollWidth + " clientWidth " + page.clientWidth + (equal ? " equal" : " wider"),
      wider ? "board wider" : "board fits",
      moved ? "board moved" : "board stuck",
      "board scrollLeft " + (board === null ? "missing" : String(Math.round(board.scrollLeft))),
    ].join(" ");
  }, 1200);
});
document.body.append(frame);
</script>`;
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
		if (url.pathname === "/proof/lane-390") {
			return new Response(framedBoard(390, 120), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		if (url.pathname === "/proof/lane-700") {
			return new Response(framedBoard(700, 200), {
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
		const type = upstream.headers.get("content-type") ?? "";
		if (!type.includes("text/html")) {
			return upstream;
		}
		const html = (await upstream.text()).replace(
			"</body>",
			`${probeScript}</body>`,
		);
		const headers = new Headers(upstream.headers);
		headers.delete("content-length");
		return new Response(html, { status: upstream.status, headers });
	},
});
