#!/usr/bin/env bun
import { mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { version } from "../package.json";
import { start } from "./app.ts";
import { loadConfiguration } from "./configuration.ts";
import { ownerRepo } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { checkToken } from "./github.ts";
import { checkLinearKey, missingLinearKey } from "./linear.ts";
import type { CheckoutSource, LocalCheckout, TodoSource } from "./ports.ts";

export const missingToken =
	'GITHUB_TOKEN is missing: set GITHUB_TOKEN or run "gh auth login".';
export const rejectedToken =
	"GITHUB_TOKEN was rejected by GitHub (HTTP 401): set a valid token.";
export { missingLinearKey };
export const rejectedLinearKey =
	"LINEAR_API_KEY was rejected by Linear (HTTP 401): set a valid key.";

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
	waitForStop?: Promise<void>;
	listTodos?: TodoSource;
	listCheckouts?: CheckoutSource;
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

const devkitConfig = z.object({
	tracker: z
		.object({
			kind: z.string().nullish(),
		})
		.nullish(),
	github: z
		.object({
			issues_repo: z.string().nullish(),
		})
		.nullish(),
});

function originFromConfig(
	text: string,
): { owner: string; repo: string } | null {
	const section = text.match(/\[remote\s+"origin"\]([\s\S]*?)(?:\n\[|$)/);
	const url = section?.[1]?.match(/^\s*url\s*=\s*(\S+)/m)?.[1];
	if (url === undefined) {
		return null;
	}
	const match = url.match(
		/^(?:https?:\/\/[^/]+\/|git@[^:]+:|ssh:\/\/git@[^/]+\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/,
	);
	if (match?.[1] === undefined || match[2] === undefined) {
		return null;
	}
	const repo = `${match[1]}/${match[2]}`;
	return ownerRepo.test(repo) ? { owner: match[1], repo } : null;
}

function parseDevkitConfig(text: string): z.infer<typeof devkitConfig> | null {
	try {
		return devkitConfig.parse(Bun.TOML.parse(text));
	} catch {
		return null;
	}
}

async function command(args: string[]): Promise<string | null> {
	const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const stdout = proc.stdout;
	if (typeof stdout === "number" || stdout === undefined) {
		proc.kill();
		return null;
	}
	const [out, code] = await Promise.all([
		new Response(stdout).text(),
		proc.exited,
	]);
	return code === 0 ? out.trim() : null;
}

async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

async function worktreeNames(path: string): Promise<string[]> {
	const proc = Bun.spawn(
		["git", "-C", path, "worktree", "list", "--porcelain"],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
		},
	);
	const stdout = proc.stdout;
	if (typeof stdout === "number" || stdout === undefined) {
		proc.kill();
		return [];
	}
	const [out, code] = await Promise.all([
		new Response(stdout).text(),
		proc.exited,
	]);
	if (code !== 0) {
		return [];
	}
	const names: string[] = [];
	for (const line of out.split("\n")) {
		if (line.startsWith("worktree ")) {
			names.push(basename(line.slice("worktree ".length).trim()));
		} else if (line.startsWith("branch ")) {
			names.push(line.slice("branch refs/heads/".length).trim());
		}
	}
	return names;
}

async function readCheckout(path: string): Promise<LocalCheckout | null> {
	const configText = await readText(join(path, ".git", "config"));
	const devkitText = await readText(join(path, "devkit.toml"));
	if (configText === null && devkitText === null) {
		return null;
	}
	const origin = configText === null ? null : originFromConfig(configText);
	const parsed = devkitText === null ? null : parseDevkitConfig(devkitText);
	const kind = parsed?.tracker?.kind ?? null;
	const configured = parsed?.github?.issues_repo?.trim() ?? "";
	const hasTrackerConfig =
		kind === "linear" || (kind === "github" && ownerRepo.test(configured));
	if (kind === "linear") {
		return {
			repo: "",
			tracker: "linear",
			path,
			names: await worktreeNames(path),
		};
	}
	if (!hasTrackerConfig && origin === null) {
		return null;
	}
	const repo = ownerRepo.test(configured) ? configured : (origin?.repo ?? "");
	if (!ownerRepo.test(repo)) {
		return null;
	}
	return {
		repo,
		tracker: "github",
		path,
		originOwner: origin?.owner ?? "",
		hasTrackerConfig,
	};
}

export async function listDevkitCheckouts(
	roots: string[],
): Promise<LocalCheckout[]> {
	const found: LocalCheckout[] = [];
	const seen = new Set<string>();
	for (const root of roots) {
		let owners: string[];
		try {
			owners = await readdir(root);
		} catch {
			continue;
		}
		for (const owner of owners) {
			const ownerPath = join(root, owner);
			let names: string[];
			try {
				names = await readdir(ownerPath);
			} catch {
				continue;
			}
			const children = [
				ownerPath,
				...names.map((name) => join(ownerPath, name)),
			];
			for (const path of children) {
				if (
					basename(path).endsWith("_worktrees") ||
					basename(path).endsWith("_workspaces")
				) {
					continue;
				}
				const checkout = await readCheckout(path);
				if (checkout === null) {
					continue;
				}
				const id = `${checkout.tracker}:${checkout.path ?? checkout.repo}`;
				if (seen.has(id)) {
					continue;
				}
				seen.add(id);
				found.push(checkout);
			}
		}
	}
	return found;
}

export async function listDevkitTodos(): Promise<string> {
	const devkit = Bun.which("devkit");
	if (devkit === null) {
		return "";
	}
	return (await command([devkit, "todo", "list", "--all", "--json"])) ?? "";
}

export async function readGhAuthToken(
	env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
	const gh = Bun.which("gh", { PATH: env.PATH ?? "" });
	if (gh === null) {
		return null;
	}
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([gh, "auth", "token"], {
			stdout: "pipe",
			stderr: "pipe",
			env,
		});
	} catch (error) {
		const code =
			error instanceof Error && "code" in error ? String(error.code) : "";
		if (code === "ENOENT") {
			return null;
		}
		throw error;
	}
	const stdout = proc.stdout;
	if (typeof stdout === "number" || stdout === undefined) {
		proc.kill();
		return null;
	}
	const [out, code] = await Promise.all([
		new Response(stdout).text(),
		proc.exited,
	]);
	if (code !== 0) {
		return null;
	}
	const token = out.trim();
	return token === "" ? null : token;
}

function defaultConfigPath(env: Record<string, string | undefined>): string {
	const root = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
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
	return io.readGhToken(io.env);
}

async function openStore(path: string): Promise<void> {
	if (path === ":memory:") {
		return;
	}
	await mkdir(dirname(path), { recursive: true });
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

	try {
		const configPath = (configFlag ?? defaultConfigPath(io.env)).trim();
		const configuration = await loadConfiguration(configPath);
		const needsGithub = configuration.pinned.some(
			(pin) => pin.tracker === "github",
		);
		let token: string | null = null;
		if (needsGithub) {
			token = await resolveToken(io);
			if (token === null) {
				writeErr(missingToken);
				return result(1, false);
			}

			const user = await checkToken(token, io.fetch);
			if (user.status === 401) {
				writeErr(rejectedToken);
				return result(1, false);
			}
			if (!user.ok) {
				writeErr(`GitHub token check failed (HTTP ${user.status}).`);
				return result(1, false);
			}
		} else {
			const fromEnv = io.env.GITHUB_TOKEN?.trim() ?? "";
			if (fromEnv !== "") {
				token = fromEnv;
			}
		}
		const linearKey = io.env.LINEAR_API_KEY?.trim() ?? "";
		const needsLinear = configuration.pinned.some(
			(pin) => pin.tracker === "linear",
		);
		if (needsLinear && linearKey === "") {
			writeErr(missingLinearKey);
			return result(1, false);
		}
		if (needsLinear) {
			const viewer = await checkLinearKey(linearKey, io.fetch);
			if (viewer.status === 401) {
				writeErr(rejectedLinearKey);
				return result(1, false);
			}
			if (!viewer.ok) {
				writeErr(`Linear key check failed (HTTP ${viewer.status}).`);
				return result(1, false);
			}
		}

		const databasePath = io.databasePath ?? defaultStorePath(io.env);
		await openStore(databasePath);
		const running = await start({
			configPath,
			token,
			linearKey: linearKey === "" ? null : linearKey,
			fetch: io.fetch,
			databasePath,
			hostname: hostFlag ?? io.hostname ?? "127.0.0.1",
			port: portFlag !== undefined ? Number(portFlag) : (io.port ?? 0),
			listTodos: io.listTodos ?? listDevkitTodos,
			listCheckouts:
				io.listCheckouts ??
				(() => listDevkitCheckouts(configuration.checkoutRoots)),
			...(io.now === undefined ? {} : { now: io.now }),
		});
		writeOut(running.url.href);
		await (io.waitForStop ?? Promise.resolve());
		await running.stop();
		return result(0, true);
	} catch (error) {
		writeErr(error instanceof Error ? error.message : "startup failed");
		return result(1, false);
	}
}

if (import.meta.main) {
	const result = await run(process.argv.slice(2), {
		env: process.env,
		fetch: globalThis.fetch,
		readGhToken: readGhAuthToken,
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: new Promise<void>((resolve) => {
			const stop = () => resolve();
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		}),
	});
	process.exit(result.exitCode);
}
