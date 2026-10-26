import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const checkout = dirname(import.meta.dir);

async function cli(args: string[]) {
	const home = await mkdtemp(join(tmpdir(), "project-flow-cli-"));
	try {
		const proc = Bun.spawn(
			[process.execPath, join(checkout, "src", "main.ts"), ...args],
			{
				cwd: checkout,
				stdout: "pipe",
				stderr: "pipe",
				timeout: 10_000,
				env: {
					...process.env,
					XDG_CONFIG_HOME: join(home, "config"),
					XDG_DATA_HOME: join(home, "data"),
				},
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, exitCode, written: await readdir(home) };
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

describe("CLI flags", () => {
	test("--help prints usage, exits 0 and writes no configuration or store", async () => {
		const result = await cli(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toStartWith("Usage: project-flow");
		expect(result.written).toEqual([]);
	});

	test.each([
		["--bogus", ["--bogus"]],
		["-h", ["--port", "4000", "-h"]],
	])(
		"unknown flag %s exits 1, names the flag and writes no configuration or store",
		async (flag, args) => {
			const result = await cli(args);
			expect(result.exitCode).toBe(1);
			expect(result.stderr.trim()).toBe(`unknown flag: ${flag} (see --help)`);
			expect(result.written).toEqual([]);
		},
	);
});
