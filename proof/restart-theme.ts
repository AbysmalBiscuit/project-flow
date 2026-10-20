import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const port = process.env.PORT ?? "4174";
const page = `http://127.0.0.1:${port}/`;
const dir = await mkdtemp(join("/var/tmp", "project-flow-theme-proof-"));
let next: ChildProcess | null = null;

function serve(generation: string): ChildProcess {
	return spawn("bun", ["proof/serve-open.ts"], {
		env: {
			...process.env,
			PORT: port,
			THEME_PROOF_DIR: dir,
			THEME_PROOF_RESTART: generation,
		},
		stdio: "inherit",
	});
}

const child = serve("0");

function stopChild(): void {
	child.kill("SIGTERM");
	next?.kill("SIGTERM");
}

process.once("SIGINT", stopChild);
process.once("SIGTERM", stopChild);

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 4176,
	async fetch(request) {
		if (new URL(request.url).pathname !== "/restart") {
			return new Response(null, { status: 404 });
		}
		const deadline = Date.now() + 8_000;
		let interval = "";
		while (Date.now() < deadline) {
			const settings = await fetch(new URL("/api/settings", page)).catch(
				() => null,
			);
			if (settings?.ok) {
				const body = (await settings.json()) as {
					theme?: string;
					pollIntervalSeconds?: number;
				};
				if (body.theme === "dark") {
					interval = String(body.pollIntervalSeconds ?? "");
					break;
				}
			}
			await Bun.sleep(50);
		}
		child.kill("SIGTERM");
		const gone = Date.now() + 8_000;
		while (Date.now() < gone) {
			const probe = await fetch(page).catch(() => null);
			if (probe === null) {
				break;
			}
			await Bun.sleep(50);
		}
		next = serve("1");
		const up = Date.now() + 8_000;
		while (Date.now() < up) {
			const probe = await fetch(page).catch(() => null);
			if (probe?.ok) {
				const html = await probe.text();
				if (html.includes('data-theme="dark"')) {
					const settings = await fetch(new URL("/api/settings", page)).catch(
						() => null,
					);
					const body = settings?.ok
						? ((await settings.json()) as { pollIntervalSeconds?: number })
						: null;
					const saved = String(body?.pollIntervalSeconds ?? interval);
					return new Response(
						`<!doctype html><html style="background-color:#000000;color:#ededed"><body>restarted interval ${saved}</body></html>`,
						{ headers: { "content-type": "text/html;charset=utf-8" } },
					);
				}
			}
			await Bun.sleep(50);
		}
		return new Response("restart failed", { status: 500 });
	},
});

await new Promise<void>((resolve) => {
	child.once("exit", () => {
		next?.once("exit", () => resolve());
	});
});
await server.stop(true);
await rm(dir, { recursive: true, force: true });
process.exit(0);
