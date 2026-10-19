import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const nowhere = "unix:path=/session-bus-goes-nowhere";

function busNames(env: Record<string, string | undefined>): string[] {
	return Object.keys(env)
		.filter((name) => name.startsWith("DBUS_"))
		.sort();
}

test("a test process and its child drop the session bus", () => {
	expect(process.env.XDG_RUNTIME_DIR).toBeUndefined();
	expect(process.env.DBUS_SESSION_BUS_ADDRESS).toBe(nowhere);
	expect(busNames(process.env)).toEqual(["DBUS_SESSION_BUS_ADDRESS"]);

	const child = Bun.spawnSync(
		[
			"bun",
			"-e",
			"const names = Object.keys(process.env).filter((name) => name.startsWith('DBUS_')).sort(); console.log(JSON.stringify({ runtime: process.env.XDG_RUNTIME_DIR ?? null, bus: process.env.DBUS_SESSION_BUS_ADDRESS ?? null, names }))",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	expect(child.exitCode).toBe(0);
	expect(JSON.parse(child.stdout.toString())).toEqual({
		runtime: null,
		bus: nowhere,
		names: ["DBUS_SESSION_BUS_ADDRESS"],
	});

	const bare = Bun.spawnSync(["printenv", "DBUS_SESSION_BUS_ADDRESS"]);
	expect(bare.exitCode).toBe(0);
	expect(bare.stdout.toString().trim()).toBe(nowhere);

	const inherited = Bun.spawnSync(["printenv", "DBUS_SESSION_BUS_ADDRESS"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(inherited.exitCode).toBe(0);
	expect(inherited.stdout.toString().trim()).toBe(nowhere);

	const replaced = Bun.spawnSync(
		[
			"bun",
			"-e",
			"console.log(JSON.stringify({ runtime: process.env.XDG_RUNTIME_DIR ?? null, bus: process.env.DBUS_SESSION_BUS_ADDRESS ?? null, names: Object.keys(process.env).filter((name) => name.startsWith('DBUS_')).sort() }))",
		],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: {
				PATH: process.env.PATH ?? "",
				XDG_RUNTIME_DIR: "/run/user/1000",
				DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
				DBUS_STARTER_ADDRESS: "unix:path=/run/user/1000/bus",
			},
		},
	);
	expect(replaced.exitCode).toBe(0);
	expect(JSON.parse(replaced.stdout.toString())).toEqual({
		runtime: null,
		bus: nowhere,
		names: ["DBUS_SESSION_BUS_ADDRESS"],
	});
});

test("git credential fill for github.com runs no helper", async () => {
	const dir = await mkdtemp(join(tmpdir(), "project-flow-git-"));
	try {
		const log = join(dir, "helper-ran");
		const helper = join(dir, "helper");
		await writeFile(
			helper,
			`#!/bin/sh\nprintf ran >> ${JSON.stringify(log)}\nprintf "username=x\\npassword=y\\n"\n`,
		);
		await chmod(helper, 0o755);
		const host = join(dir, "host.gitconfig");
		await writeFile(
			host,
			`[credential "https://github.com"]\n\thelper = ${helper}\n`,
		);
		process.env.GIT_CONFIG_GLOBAL = host;
		process.env.GIT_CONFIG_COUNT = "1";
		process.env.GIT_CONFIG_KEY_0 = "credential.https://github.com.helper";
		process.env.GIT_CONFIG_VALUE_0 = helper;

		const done = Bun.spawnSync(["git", "credential", "fill"], {
			stdin: Buffer.from("protocol=https\nhost=github.com\n\n"),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await Bun.file(log).exists()).toBe(false);
		expect(done.stdout.toString()).not.toContain("password");
		expect(process.env.GIT_CONFIG_NOSYSTEM).toBe("1");
		expect(process.env.GIT_CONFIG_GLOBAL).toBeDefined();
		expect(process.env.GIT_CONFIG_GLOBAL).not.toBe(host);
		expect(
			await Bun.file(process.env.GIT_CONFIG_GLOBAL ?? "").text(),
		).not.toContain("helper");

		for (const input of [
			"protocol=https\nhost=   \n\n",
			"protocol=https\nhost=git hub.com\n\n",
			"\n",
		]) {
			const edge = Bun.spawnSync(["git", "credential", "fill"], {
				stdin: Buffer.from(input),
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(await Bun.file(log).exists()).toBe(false);
			expect(edge.stdout.toString()).not.toContain("password");
			expect(edge.exitCode).not.toBe(0);
		}

		const injected = Bun.spawnSync(["git", "credential", "fill"], {
			stdin: Buffer.from("protocol=https\nhost=github.com\n\n"),
			stdout: "pipe",
			stderr: "pipe",
			env: {
				PATH: process.env.PATH ?? "",
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
				GIT_CONFIG_VALUE_0: helper,
				GIT_CONFIG_GLOBAL: host,
			},
		});
		expect(await Bun.file(log).exists()).toBe(false);
		expect(injected.stdout.toString()).not.toContain("password");
		expect(process.env.GIT_CONFIG_GLOBAL).not.toBe(host);
	} finally {
		await rm(dir, { recursive: true, force: true });
		delete process.env.GIT_CONFIG_COUNT;
		delete process.env.GIT_CONFIG_KEY_0;
		delete process.env.GIT_CONFIG_VALUE_0;
	}
});
