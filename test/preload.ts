import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const nowhere = "unix:path=/session-bus-goes-nowhere";

function isolateBus(env: Record<string, string | undefined>): void {
	for (const name of Object.keys(env)) {
		if (name === "XDG_RUNTIME_DIR" || name.startsWith("DBUS_")) {
			delete env[name];
		}
	}
	env.DBUS_SESSION_BUS_ADDRESS = nowhere;
}

function dropCredentialKeys(env: Record<string, string | undefined>): void {
	const count = env.GIT_CONFIG_COUNT ?? "";
	if (!/^\d+$/.test(count)) {
		return;
	}
	for (let index = 0; index < Number(count); index += 1) {
		const key = env[`GIT_CONFIG_KEY_${index}`] ?? "";
		if (key.includes("credential") && key.includes("helper")) {
			env[`GIT_CONFIG_VALUE_${index}`] = "";
		}
	}
}

function testGitConfig(): string {
	const configured = process.env.PROJECT_FLOW_TEST_GIT_CONFIG;
	if (configured !== undefined && configured !== "") {
		return configured;
	}
	const dir = join(tmpdir(), `project-flow-git-config-${process.pid}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "gitconfig");
	writeFileSync(path, "[maintenance]\n\tauto = false\n");
	process.env.PROJECT_FLOW_TEST_GIT_CONFIG = path;
	return path;
}

function isolateGit(env: Record<string, string | undefined>): void {
	dropCredentialKeys(env);
	env.GIT_CONFIG_GLOBAL = testGitConfig();
	env.GIT_CONFIG_NOSYSTEM = "1";
}

function isolateChild(env: Record<string, string | undefined>): void {
	isolateBus(env);
	isolateGit(env);
}

isolateChild(process.env);

const spawn = Bun.spawn.bind(Bun);
const spawnSync = Bun.spawnSync.bind(Bun);

type SpawnOptions = NonNullable<Parameters<typeof Bun.spawn>[1]>;

function optionsOf(
	args: Parameters<typeof Bun.spawn>,
): SpawnOptions | undefined {
	const second = args[1];
	if (second !== undefined && !Array.isArray(second)) {
		return second;
	}
	const first = args[0];
	if (!Array.isArray(first) && typeof first === "object") {
		return first;
	}
	return undefined;
}

function withChildEnv(
	args: Parameters<typeof Bun.spawn>,
): Parameters<typeof Bun.spawn> {
	isolateChild(process.env);
	const options = optionsOf(args);
	if (options === undefined) {
		return [args[0], { env: { ...process.env } }];
	}
	const given = options.env;
	const env: Record<string, string | undefined> =
		given === undefined ? { ...process.env } : { ...given };
	isolateChild(env);
	options.env = env;
	return args;
}

Bun.spawn = ((...args: Parameters<typeof Bun.spawn>) =>
	spawn(...withChildEnv(args))) as typeof Bun.spawn;
Bun.spawnSync = ((...args: Parameters<typeof Bun.spawnSync>) =>
	spawnSync(...withChildEnv(args))) as typeof Bun.spawnSync;
