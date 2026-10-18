#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json";
import { start } from "./app.ts";
import { loadConfiguration } from "./configuration.ts";
import type { Fetch } from "./fetch.ts";

export const missingToken =
	'GITHUB_TOKEN is missing: set GITHUB_TOKEN or run "gh auth login".';
export const rejectedToken =
	"GITHUB_TOKEN was rejected by GitHub (HTTP 401): set a valid token.";

export type RunIo = {
	env: Record<string, string | undefined>;
	fetch: Fetch;
	readGhToken: () => Promise<string | null>;
	stdout?: (line: string) => void;
	stderr?: (line: string) => void;
	databasePath?: string;
	hostname?: string;
	port?: number;
};

export type RunResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
	listened: boolean;
};

export async function readGhAuthToken(): Promise<string | null> {
	const proc = Bun.spawn(["gh", "auth", "token"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, code] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	if (code !== 0) {
		return null;
	}
	const token = out.trim();
	return token === "" ? null : token;
}

function defaultConfigPath(): string {
	const root = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(root, "project-flow", "config.json");
}

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) {
		return undefined;
	}
	return args[index + 1];
}

async function resolveToken(io: RunIo): Promise<string | null> {
	const fromEnv = io.env.GITHUB_TOKEN;
	if (fromEnv !== undefined && fromEnv.trim() !== "") {
		return fromEnv;
	}
	return io.readGhToken();
}

async function checkToken(token: string, fetchImpl: Fetch): Promise<boolean> {
	const response = await fetchImpl("https://api.github.com/user", {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"x-github-api-version": "2022-11-28",
		},
	});
	return response.status !== 401;
}

export async function run(args: string[], io: RunIo): Promise<RunResult> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	const writeOut = io.stdout ?? ((line: string) => stdoutLines.push(line));
	const writeErr = io.stderr ?? ((line: string) => stderrLines.push(line));
	const result = (exitCode: number, listened: boolean): RunResult => ({
		exitCode,
		stderr: stderrLines.join("\n"),
		stdout: stdoutLines.join("\n"),
		listened,
	});

	if (args.includes("--version")) {
		writeOut(version);
		return result(0, false);
	}

	const configFlag = flagValue(args, "--config");
	if (
		args.includes("--config") &&
		(configFlag === undefined || configFlag.trim() === "")
	) {
		writeErr("invalid configuration: --config needs a file path");
		return result(1, false);
	}

	const portFlag = flagValue(args, "--port");
	const hostFlag = flagValue(args, "--host");
	if (
		args.includes("--port") &&
		(portFlag === undefined || !/^\d+$/.test(portFlag))
	) {
		writeErr("invalid port: --port needs a port number");
		return result(1, false);
	}

	const token = await resolveToken(io);
	if (token === null) {
		writeErr(missingToken);
		return result(1, false);
	}

	const accepted = await checkToken(token, io.fetch);
	if (!accepted) {
		writeErr(rejectedToken);
		return result(1, false);
	}

	const configPath = configFlag ?? defaultConfigPath();
	try {
		await loadConfiguration(configPath);
	} catch (error) {
		writeErr(error instanceof Error ? error.message : "invalid configuration");
		return result(1, false);
	}

	const running = await start({
		configPath,
		token,
		fetch: io.fetch,
		databasePath: io.databasePath ?? ":memory:",
		hostname: hostFlag ?? io.hostname ?? "127.0.0.1",
		port: portFlag !== undefined ? Number(portFlag) : (io.port ?? 0),
	});
	writeOut(running.url.href);
	if (import.meta.main) {
		await new Promise<void>(() => {});
	}
	await running.stop();
	return result(0, true);
}

if (import.meta.main) {
	const result = await run(process.argv.slice(2), {
		env: process.env,
		fetch: globalThis.fetch,
		readGhToken: readGhAuthToken,
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
	});
	process.exit(result.exitCode);
}
