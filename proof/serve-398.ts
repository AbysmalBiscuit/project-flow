import { createServer } from "node:net";

const toneProbe = `<script>
document.addEventListener("DOMContentLoaded", () => {
  const run = document.createElement("button");
  run.type = "button";
  run.id = "tone-probe-run";
  run.textContent = "Probe tones";
  const out = document.createElement("pre");
  out.id = "tone-probe";
  out.style.cssText = "position:fixed;right:0;bottom:0;z-index:9;margin:0;padding:4px;background:#fff;color:#000;font:11px monospace";
  run.style.cssText = "position:fixed;left:0;bottom:0;z-index:9";
  run.addEventListener("click", () => {
    const lines = new Set();
    const add = (view, state, colour) => lines.add(view + " " + state + " " + colour);
    for (const mark of document.querySelectorAll("[data-lane] h2 [data-state]")) {
      const state = mark.getAttribute("data-state");
      add("lane-mark", state, getComputedStyle(mark).backgroundColor);
      const lane = mark.closest("[data-lane]");
      for (const card of lane.querySelectorAll("button[data-ticket]")) {
        add("card", state, getComputedStyle(card).borderTopColor);
      }
    }
    for (const node of document.querySelectorAll("[data-graph-node][data-state]")) {
      add("graph-node", node.getAttribute("data-state"), getComputedStyle(node).borderTopColor);
    }
    for (const dot of document.querySelectorAll("li > [data-state]")) {
      add("graph-legend", dot.getAttribute("data-state"), getComputedStyle(dot).backgroundColor);
    }
    for (const swatch of document.querySelectorAll("p span > [data-state]")) {
      add("legend", swatch.getAttribute("data-state"), getComputedStyle(swatch).backgroundColor);
    }
    for (const segment of document.querySelectorAll("[role=progressbar] > [data-state]")) {
      add("bar", segment.getAttribute("data-state"), getComputedStyle(segment).backgroundColor);
    }
    out.textContent = [...lines].sort().join("\\n");
  });
  document.body.append(run, out);
});
</script>`;

const publicPort = process.argv[2] ?? "47398";
const theme = process.argv[3] === "dark" ? "dark" : "light";
const appPort = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once("error", reject);
	probe.listen(0, "127.0.0.1", () => {
		const address = probe.address();
		if (address === null || typeof address === "string") {
			reject(new Error("tone proof has no app port"));
			return;
		}
		const chosen = address.port;
		probe.close(() => resolve(chosen));
	});
});

const app = Bun.spawn(
	["bun", `${import.meta.dir}/serve-card-lanes.ts`, String(appPort), theme],
	{ stdout: "inherit", stderr: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		app.kill();
		process.exit(0);
	});
}

Bun.serve({
	hostname: "127.0.0.1",
	port: Number(publicPort),
	async fetch(request) {
		const url = new URL(request.url);
		const target = `http://127.0.0.1:${String(appPort)}${url.pathname}${url.search}`;
		for (let attempt = 0; attempt < 100; attempt += 1) {
			try {
				const response = await fetch(target, {
					method: request.method,
					headers: request.headers,
					body: request.body,
				});
				const type = response.headers.get("content-type") ?? "";
				if (!type.includes("text/html")) {
					return response;
				}
				const html = await response.text();
				const headers = new Headers(response.headers);
				headers.delete("content-length");
				return new Response(html.replace("</body>", `${toneProbe}</body>`), {
					status: response.status,
					headers,
				});
			} catch {
				await Bun.sleep(100);
			}
		}
		return new Response("tone proof app did not listen", { status: 503 });
	},
});
