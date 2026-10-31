#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { version } from "../package.json";
import { start } from "./app.ts";
import { readCredentials, rejectedCredential } from "./backends.ts";
import { configArgsForCheckout, parseFlags, usage } from "./cli-flags.ts";
import { loadConfiguration } from "./configuration.ts";
import { listDevkitCheckouts, listDevkitTodos } from "./devkit-checkouts.ts";
import type { FactoryTokenMint } from "./factory-tokens.ts";
import type { Fetch } from "./fetch.ts";
import { openBrowser } from "./open-browser.ts";
import type { CheckoutSource, TodoSource } from "./ports.ts";
import { readGhAuthToken, runFactoryMint } from "./token-commands.ts";

export type RunIo = {
	env: Record<string, string | undefined>;
	fetch: Fetch;
	readGhToken: (
		env?: Record<string, string | undefined>,
	) => Promise<string | null>;
	stdout?: (line: string) => void;
	stderr?: (line: string) => void;
	databasePath?: string;
	hostname?: string;
	port?: number;
	now?: () => Date;
	threadReadLimitMs?: number;
	trackerRequestLimitMs?: number;
	intervalSecondMs?: number;
	runTickMs?: number;
	idleTimeoutSeconds?: number;
	waitForStop?: Promise<void>;
	listTodos?: TodoSource;
	listCheckouts?: CheckoutSource;
	open?: (url: string) => Promise<void>;
	mintFactoryTokens?: FactoryTokenMint;
	mintRetryDelayMs?: number;
};

export type RunResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
	listened: boolean;
};

export function defaultStorePath(
	env: Record<string, string | undefined>,
): string {
	const root = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(root, "project-flow", "project-flow.sqlite");
}

function defaultConfigPath(env: Record<string, string | undefined>): string {
	const root = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(root, "project-flow", "config.json");
}

async function openStore(path: string): Promise<void> {
	if (path === ":memory:") {
		return;
	}
	await mkdir(dirname(path), { recursive: true });
}

export function waitForStop(): Promise<void> {
	return new Promise((resolve) => {
		const stop = () => resolve();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
}

export async function run(args: string[], io: RunIo): Promise<RunResult> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	let listened = false;
	const writeOut = io.stdout ?? ((line: string) => stdoutLines.push(line));
	const writeErr = io.stderr ?? ((line: string) => stderrLines.push(line));
	const result = (exitCode: number): RunResult => ({
		exitCode,
		stderr: stderrLines.join("\n"),
		stdout: stdoutLines.join("\n"),
		listened,
	});

	if (args.includes("--help")) {
		writeOut(usage);
		return result(0);
	}

	if (args.includes("--version")) {
		writeOut(version);
		return result(0);
	}

	const flags = parseFlags(args);
	if ("error" in flags) {
		writeErr(flags.error);
		return result(1);
	}
	const { configFlag, hostFlag, portFlag, flagFactories } = flags;

	try {
		const configPath = (configFlag ?? defaultConfigPath(io.env)).trim();
		if (!existsSync(configPath)) {
			await mkdir(dirname(configPath), { recursive: true });
			await writeFile(configPath, "{}\n");
			writeErr(`created configuration file: ${configPath}`);
		}
		const configuration = await loadConfiguration(configPath);
		const credentials = await readCredentials(io);
		const databasePath = io.databasePath ?? defaultStorePath(io.env);
		await openStore(databasePath);
		const running = await start({
			configPath,
			credentials,
			env: io.env,
			fetch: io.fetch,
			databasePath,
			hostname: hostFlag ?? io.hostname ?? "127.0.0.1",
			port: portFlag !== undefined ? Number(portFlag) : (io.port ?? 0),
			listTodos: io.listTodos ?? listDevkitTodos,
			listCheckouts:
				io.listCheckouts ?? ((roots) => listDevkitCheckouts(roots, io.env)),
			flagFactories,
			...(io.now === undefined ? {} : { now: io.now }),
			...(io.threadReadLimitMs === undefined
				? {}
				: { threadReadLimitMs: io.threadReadLimitMs }),
			...(io.trackerRequestLimitMs === undefined
				? {}
				: { trackerRequestLimitMs: io.trackerRequestLimitMs }),
			...(io.intervalSecondMs === undefined
				? {}
				: { intervalSecondMs: io.intervalSecondMs }),
			...(io.runTickMs === undefined ? {} : { runTickMs: io.runTickMs }),
			...(io.idleTimeoutSeconds === undefined
				? {}
				: { idleTimeoutSeconds: io.idleTimeoutSeconds }),
			...(io.mintFactoryTokens === undefined
				? {}
				: { mintFactoryTokens: io.mintFactoryTokens }),
			...(io.mintRetryDelayMs === undefined
				? {}
				: { mintRetryDelayMs: io.mintRetryDelayMs }),
		});
		listened = true;
		writeOut(running.url.href);
		if (args.includes("--open")) {
			const open = io.open ?? ((url) => openBrowser(url, io.env));
			void open(running.url.href).catch(() =>
				writeErr("warning: could not open the browser"),
			);
		}
		const credential = rejectedCredential(
			credentials,
			configuration,
			io.env,
			io.fetch,
			writeErr,
		).catch((error: unknown) => {
			writeErr(
				error instanceof Error ? error.message : "credential check failed",
			);
			return null;
		});
		const stop = io.waitForStop ?? new Promise<void>(() => {});
		const outcome = await Promise.race([
			credential.then((message) => ({ kind: "credential" as const, message })),
			stop.then(() => ({ kind: "stop" as const })),
		]);
		if (outcome.kind === "credential" && outcome.message !== null) {
			writeErr(outcome.message);
			await running.stop();
			return result(1);
		}
		const coldStart = await running.settled;
		if (coldStart instanceof Error) {
			await running.stop();
			throw coldStart;
		}
		await stop;
		await running.stop();
		return result(0);
	} catch (error) {
		writeErr(error instanceof Error ? error.message : "startup failed");
		return result(1);
	}
}

if (import.meta.main) {
	const checkout = dirname(import.meta.dir);
	const bunfig = join(checkout, "bunfig.toml");
	if (existsSync(bunfig) && process.cwd() !== checkout) {
		const callerDir = process.cwd();
		const child = Bun.spawn(
			[
				process.execPath,
				...process.execArgv,
				...configArgsForCheckout(process.argv.slice(1), callerDir),
			],
			{
				cwd: checkout,
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		process.exit(await child.exited);
	}
	const result = await run(process.argv.slice(2), {
		env: process.env,
		fetch: globalThis.fetch,
		readGhToken: readGhAuthToken,
		mintFactoryTokens: runFactoryMint,
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: waitForStop(),
	});
	process.exit(result.exitCode);
}
