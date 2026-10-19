import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const nowhere = "unix:path=/session-bus-goes-nowhere";

const childProbe =
	"const names = Object.keys(process.env).filter((name) => name.startsWith('DBUS_')).sort(); console.log(JSON.stringify({ runtime: process.env.XDG_RUNTIME_DIR ?? null, bus: process.env.DBUS_SESSION_BUS_ADDRESS ?? null, names, prompt: process.env.GIT_TERMINAL_PROMPT ?? null, askpass: process.env.GIT_ASKPASS ?? null, sshAskpass: process.env.SSH_ASKPASS ?? null }))";

function busNames(env: Record<string, string | undefined>): string[] {
	return Object.keys(env)
		.filter((name) => name.startsWith("DBUS_"))
		.sort();
}

test("a test process and its child drop the session bus", () => {
	expect(process.env.XDG_RUNTIME_DIR).toBeUndefined();
	expect(process.env.DBUS_SESSION_BUS_ADDRESS).toBe(nowhere);
	expect(busNames(process.env)).toEqual(["DBUS_SESSION_BUS_ADDRESS"]);
	expect(process.env.GIT_TERMINAL_PROMPT).toBe("0");
	expect(process.env.GIT_ASKPASS).toBeUndefined();
	expect(process.env.SSH_ASKPASS).toBeUndefined();

	const child = Bun.spawnSync(["bun", "-e", childProbe], {
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(child.exitCode).toBe(0);
	expect(JSON.parse(child.stdout.toString())).toEqual({
		runtime: null,
		bus: nowhere,
		names: ["DBUS_SESSION_BUS_ADDRESS"],
		prompt: "0",
		askpass: null,
		sshAskpass: null,
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

	const replaced = Bun.spawnSync(["bun", "-e", childProbe], {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			PATH: process.env.PATH ?? "",
			XDG_RUNTIME_DIR: "/run/user/1000",
			DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
			DBUS_STARTER_ADDRESS: "unix:path=/run/user/1000/bus",
			GIT_ASKPASS: "/tmp/askpass-should-not-run",
			SSH_ASKPASS: "/tmp/ssh-askpass-should-not-run",
			GIT_TERMINAL_PROMPT: "1",
		},
	});
	expect(replaced.exitCode).toBe(0);
	expect(JSON.parse(replaced.stdout.toString())).toEqual({
		runtime: null,
		bus: nowhere,
		names: ["DBUS_SESSION_BUS_ADDRESS"],
		prompt: "0",
		askpass: null,
		sshAskpass: null,
	});
});

const githubFill = "protocol=https\nhost=github.com\n\n";

type FillResult = {
	stdout: string;
	exitCode: number | null;
};

type FillRun = () => FillResult | Promise<FillResult>;

const credential = {
	dir: "",
	log: "",
	helper: "",
	host: "",
	askpass: "",
};

beforeAll(async () => {
	credential.dir = await mkdtemp(join(tmpdir(), "project-flow-git-"));
	credential.log = join(credential.dir, "helper-ran");
	credential.helper = join(credential.dir, "helper");
	credential.host = join(credential.dir, "host.gitconfig");
	credential.askpass = join(credential.dir, "askpass");
	const mark = `printf ran >> ${JSON.stringify(credential.log)}\n`;
	await writeFile(
		credential.helper,
		`#!/bin/sh\n${mark}printf "username=x\\npassword=y\\n"\n`,
	);
	await chmod(credential.helper, 0o755);
	await writeFile(
		credential.host,
		`[credential "https://github.com"]\n\thelper = ${credential.helper}\n`,
	);
	await writeFile(credential.askpass, `#!/bin/sh\n${mark}printf 'y\\n'\n`);
	await chmod(credential.askpass, 0o755);
});

afterAll(async () => {
	if (credential.dir !== "") {
		await rm(credential.dir, { recursive: true, force: true });
	}
});

async function fill(run: FillRun): Promise<FillResult> {
	const result = await run();
	expect(await Bun.file(credential.log).exists()).toBe(false);
	expect(result.stdout).not.toContain("password");
	return result;
}

function hostileEnv(
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		PATH: process.env.PATH ?? "",
		GIT_CONFIG_KEY_0: "CrEdEnTiAl.HeLpEr",
		GIT_CONFIG_VALUE_0: credential.helper,
		GIT_CONFIG_PARAMETERS: `'credential.helper'='${credential.helper}'`,
		...extra,
	};
}

function plantParentHelper(): void {
	process.env.GIT_CONFIG_GLOBAL = credential.host;
	process.env.GIT_CONFIG_COUNT = "1";
	process.env.GIT_CONFIG_KEY_0 = "Credential.Helper";
	process.env.GIT_CONFIG_VALUE_0 = credential.helper;
	process.env.GIT_CONFIG_PARAMETERS = `'credential.helper'='${credential.helper}'`;
	process.env.GIT_ASKPASS = credential.askpass;
	process.env.SSH_ASKPASS = credential.askpass;
}

function clearPlantedHelper(): void {
	delete process.env.GIT_CONFIG_COUNT;
	delete process.env.GIT_CONFIG_KEY_0;
	delete process.env.GIT_CONFIG_VALUE_0;
	delete process.env.GIT_CONFIG_PARAMETERS;
	delete process.env.GIT_ASKPASS;
	delete process.env.SSH_ASKPASS;
}

test("git credential fill for github.com runs no helper", async () => {
	plantParentHelper();
	try {
		const done = await fill(() => {
			const run = Bun.spawnSync(["git", "credential", "fill"], {
				stdin: Buffer.from(githubFill),
				stdout: "pipe",
				stderr: "pipe",
			});
			return { stdout: run.stdout.toString(), exitCode: run.exitCode };
		});
		expect(done.exitCode).not.toBe(0);
		expect(process.env.GIT_CONFIG_NOSYSTEM).toBe("1");
		expect(process.env.GIT_CONFIG_GLOBAL).toBeDefined();
		expect(process.env.GIT_CONFIG_GLOBAL).not.toBe(credential.host);
		expect(process.env.GIT_CONFIG_GLOBAL).not.toBe("/dev/null");
		expect(
			await Bun.file(process.env.GIT_CONFIG_GLOBAL ?? "").text(),
		).not.toContain("helper");
		expect(process.env.GIT_CONFIG_COUNT).toBeUndefined();
		expect(process.env.GIT_CONFIG_KEY_0).toBeUndefined();
		expect(process.env.GIT_CONFIG_VALUE_0).toBeUndefined();
		expect(process.env.GIT_CONFIG_PARAMETERS).toBeUndefined();
		expect(process.env.GIT_ASKPASS).toBeUndefined();
		expect(process.env.SSH_ASKPASS).toBeUndefined();
		expect(process.env.GIT_TERMINAL_PROMPT).toBe("0");
	} finally {
		clearPlantedHelper();
	}
});

test("git credential fill drops an injected helper env", async () => {
	const injected = await fill(() => {
		const run = Bun.spawnSync(["git", "credential", "fill"], {
			stdin: Buffer.from(githubFill),
			stdout: "pipe",
			stderr: "pipe",
			env: {
				PATH: process.env.PATH ?? "",
				GIT_CONFIG_COUNT: "2",
				GIT_CONFIG_KEY_0: "Credential.Helper",
				GIT_CONFIG_VALUE_0: credential.helper,
				GIT_CONFIG_KEY_1: "credential.helper",
				GIT_CONFIG_VALUE_1: credential.helper,
				GIT_CONFIG_PARAMETERS: `'credential.helper'='${credential.helper}'`,
				GIT_CONFIG_GLOBAL: credential.host,
				GIT_ASKPASS: credential.askpass,
				SSH_ASKPASS: credential.askpass,
				GIT_TERMINAL_PROMPT: "1",
			},
		});
		return { stdout: run.stdout.toString(), exitCode: run.exitCode };
	});
	expect(injected.exitCode).not.toBe(0);
	expect(process.env.GIT_CONFIG_GLOBAL).not.toBe(credential.host);
});

test("git credential fill ignores frozen spawn options", async () => {
	const frozen = Object.freeze({
		stdin: Buffer.from(githubFill),
		stdout: "pipe" as const,
		stderr: "pipe" as const,
	});
	const frozenRun = await fill(() => {
		const run = Bun.spawnSync(["git", "credential", "fill"], frozen);
		return { stdout: run.stdout.toString(), exitCode: run.exitCode };
	});
	expect(frozenRun.exitCode).not.toBe(0);
	expect(Object.isFrozen(frozen)).toBe(true);
});

test("git credential fill leaves the object env unchanged", async () => {
	const objectEnv = {
		PATH: process.env.PATH ?? "",
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "CrEdEnTiAl.HeLpEr",
		GIT_CONFIG_VALUE_0: credential.helper,
		GIT_CONFIG_PARAMETERS: `'credential.helper'='${credential.helper}'`,
		GIT_CONFIG_GLOBAL: credential.host,
	};
	const objectOptions = {
		cmd: ["git", "credential", "fill"],
		stdin: Buffer.from(githubFill),
		stdout: "pipe" as const,
		stderr: "pipe" as const,
		env: objectEnv,
	};
	const objectRun = await fill(() => {
		const run = Bun.spawnSync(objectOptions);
		return { stdout: run.stdout.toString(), exitCode: run.exitCode };
	});
	expect(objectOptions.env).toBe(objectEnv);
	expect(objectEnv.GIT_CONFIG_KEY_0).toBe("CrEdEnTiAl.HeLpEr");
	expect(objectEnv.GIT_CONFIG_GLOBAL).toBe(credential.host);
	expect(objectRun.exitCode).not.toBe(0);
});

test("git credential fill for example.invalid runs no helper", async () => {
	await fill(() => {
		const run = Bun.spawnSync({
			cmd: ["git", "credential", "fill"],
			stdin: Buffer.from("protocol=https\nhost=example.invalid\n\n"),
			stdout: "pipe",
			stderr: "pipe",
			env: hostileEnv(),
		});
		return { stdout: run.stdout.toString(), exitCode: run.exitCode };
	});
});

test("git credential fill leaves the async object env unchanged", async () => {
	const asyncOptions = {
		cmd: ["git", "credential", "fill"],
		stdin: Buffer.from(githubFill),
		stdout: "pipe" as const,
		stderr: "pipe" as const,
		env: hostileEnv({ GIT_CONFIG_GLOBAL: credential.host }),
	};
	const asyncRun = await fill(async () => {
		const proc = Bun.spawn(asyncOptions);
		return {
			stdout: await new Response(proc.stdout).text(),
			exitCode: await proc.exited,
		};
	});
	expect(asyncOptions.env.GIT_CONFIG_GLOBAL).toBe(credential.host);
	expect(asyncRun.exitCode).not.toBe(0);
});

test("git credential fill leaves a frozen object env unchanged", async () => {
	const frozenObject = Object.freeze({
		cmd: ["git", "credential", "fill"],
		stdin: Buffer.from(githubFill),
		stdout: "pipe" as const,
		stderr: "pipe" as const,
		env: Object.freeze(hostileEnv({ GIT_CONFIG_GLOBAL: credential.host })),
	});
	const frozenObjectRun = await fill(() => {
		const run = Bun.spawnSync(frozenObject);
		return { stdout: run.stdout.toString(), exitCode: run.exitCode };
	});
	expect(frozenObject.env.GIT_CONFIG_GLOBAL).toBe(credential.host);
	expect(frozenObject.env.GIT_CONFIG_KEY_0).toBe("CrEdEnTiAl.HeLpEr");
	expect(frozenObjectRun.exitCode).not.toBe(0);
});

test("git credential fill runs no helper on blank inputs", async () => {
	for (const input of [
		"protocol=https\nhost=   \n\n",
		"protocol=https\nhost=git hub.com\n\n",
		"\n",
		"   \n",
	]) {
		const command = await fill(() => {
			const run = Bun.spawnSync(["git", "credential", "fill"], {
				stdin: Buffer.from(input),
				stdout: "pipe",
				stderr: "pipe",
			});
			return { stdout: run.stdout.toString(), exitCode: run.exitCode };
		});
		expect(command.exitCode).not.toBe(0);
		const object = await fill(() => {
			const run = Bun.spawnSync({
				cmd: ["git", "credential", "fill"],
				stdin: Buffer.from(input),
				stdout: "pipe",
				stderr: "pipe",
				env: hostileEnv(),
			});
			return { stdout: run.stdout.toString(), exitCode: run.exitCode };
		});
		expect(object.exitCode).not.toBe(0);
	}
});
