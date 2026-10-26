import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mainPath = join(import.meta.dir, "..", "src", "main.ts");

let caller: string;

beforeEach(async () => {
	caller = await mkdtemp(join(tmpdir(), "project-flow-launcher-"));
});

afterEach(async () => {
	await rm(caller, { recursive: true, force: true });
});

// The launcher runs the app in a second process, so the test starts it in its
// own process group and stops the whole group.
function launch(args: string[]) {
	const child = spawn(process.execPath, [mainPath, ...args], {
		cwd: caller,
		detached: true,
		env: {
			HOME: caller,
			PATH: "",
			XDG_CONFIG_HOME: join(caller, "config"),
			XDG_DATA_HOME: join(caller, "data"),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const exited = once(child, "exit").then(([code]) => code);
	return {
		exited,
		output: () => ({ stdout, stderr }),
		firstLine: async () => {
			while (!stdout.includes("\n") && child.exitCode === null) {
				await Bun.sleep(20);
			}
			return stdout.split("\n")[0] ?? "";
		},
		stop: async () => {
			if (child.pid !== undefined && child.exitCode === null) {
				process.kill(-child.pid, "SIGTERM");
			}
			await exited;
		},
	};
}

describe("launcher outside the checkout", () => {
	test("--config followed by a flag exits 1 and does not listen", async () => {
		const app = launch(["--config", "--port", "0", "--host", "127.0.0.1"]);
		try {
			expect(await app.exited).toBe(1);
			const { stdout, stderr } = app.output();
			expect(stderr.trim()).toBe(
				"invalid configuration: --config needs a file path",
			);
			expect(stdout).toBe("");
			expect(existsSync(join(caller, "--port"))).toBe(false);
		} finally {
			await app.stop();
		}
	});

	test("a relative --config path reads the file in the caller folder", async () => {
		await writeFile(join(caller, "config.json"), "{}\n");
		const app = launch([
			"--config",
			"./config.json",
			"--host",
			"127.0.0.1",
			"--port",
			"0",
		]);
		try {
			const url = new URL(await app.firstLine());
			expect(url.hostname).toBe("127.0.0.1");
			expect(app.output().stderr).not.toContain("created configuration file");
		} finally {
			await app.stop();
		}
	});
});
