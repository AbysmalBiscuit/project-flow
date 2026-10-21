import "../src/status-colours.ts";
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

type SpawnCall = Parameters<typeof Bun.spawn>;
type CommandCall = [string[], SpawnCall[1]?];
type ObjectCall = [Exclude<SpawnCall[0], string[]>];

function isCommandCall(args: SpawnCall): args is CommandCall {
	return Array.isArray(args[0]);
}

function childEnv(
	given: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
	const env: Record<string, string | undefined> =
		given === undefined ? { ...process.env } : { ...given };
	isolateChild(env);
	return env;
}

function withCommandEnv(args: CommandCall): CommandCall {
	const [cmd, options] = args;
	if (options === undefined) {
		return [cmd, { env: childEnv(undefined) }];
	}
	return [cmd, Object.assign({}, options, { env: childEnv(options.env) })];
}

function withObjectEnv(args: ObjectCall): ObjectCall {
	const [options] = args;
	const given: { env?: Record<string, string | undefined> } = options;
	return [Object.assign({}, options, { env: childEnv(given.env) })];
}

function withChildEnv(args: SpawnCall): SpawnCall {
	isolateChild(process.env);
	if (isCommandCall(args)) {
		return withCommandEnv(args);
	}
	return withObjectEnv(args);
}

Bun.spawn = ((...args: Parameters<typeof Bun.spawn>) =>
	spawn(...withChildEnv(args))) as typeof Bun.spawn;
Bun.spawnSync = ((...args: Parameters<typeof Bun.spawnSync>) =>
	spawnSync(...withChildEnv(args))) as typeof Bun.spawnSync;
