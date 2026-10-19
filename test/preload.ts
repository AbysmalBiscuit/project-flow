import { afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const nowhere = "unix:path=/session-bus-goes-nowhere";

function isolateBus(env: Record<string, string | undefined>): void {
	for (const name of Object.keys(env)) {
		if (name === "XDG_RUNTIME_DIR" || name.startsWith("DBUS_")) {
			delete env[name];
		}
	}
	env.DBUS_SESSION_BUS_ADDRESS = nowhere;
}

function dropInjectedGitConfig(env: Record<string, string | undefined>): void {
	for (const name of Object.keys(env)) {
		if (
			name === "GIT_CONFIG_COUNT" ||
			name === "GIT_CONFIG_PARAMETERS" ||
			name.startsWith("GIT_CONFIG_KEY_") ||
			name.startsWith("GIT_CONFIG_VALUE_")
		) {
			delete env[name];
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
	dropInjectedGitConfig(env);
	delete env.GIT_ASKPASS;
	delete env.SSH_ASKPASS;
	env.GIT_TERMINAL_PROMPT = "0";
	env.GIT_CONFIG_GLOBAL = testGitConfig();
	env.GIT_CONFIG_NOSYSTEM = "1";
}

function isolateChild(env: Record<string, string | undefined>): void {
	isolateBus(env);
	isolateGit(env);
}

const ownedConfig = testGitConfig();
isolateChild(process.env);

afterAll(() => {
	if (process.env.PROJECT_FLOW_TEST_GIT_CONFIG === ownedConfig) {
		rmSync(dirname(ownedConfig), { recursive: true, force: true });
	}
});

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
	return [args[0], { ...options, env }];
}

Bun.spawn = ((...args: Parameters<typeof Bun.spawn>) =>
	spawn(...withChildEnv(args))) as typeof Bun.spawn;
Bun.spawnSync = ((...args: Parameters<typeof Bun.spawnSync>) =>
	spawnSync(...withChildEnv(args))) as typeof Bun.spawnSync;
