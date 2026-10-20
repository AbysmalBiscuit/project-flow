#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { version } from "../package.json";
import { start } from "./app.ts";
import type { AutoMerge } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import { ownerRepo } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { checkToken, missingToken } from "./github.ts";
import { checkLinearKey } from "./linear.ts";
import type {
	CheckoutSource,
	LocalCheckout,
	TodoSource,
	WorkcellRun,
} from "./ports.ts";

export { missingToken };
export const rejectedToken =
	"GITHUB_TOKEN was rejected by GitHub (HTTP 401): set a valid token.";
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

async function command(
	args: string[],
	env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
	const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env });
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

async function gitConfigText(path: string): Promise<string | null> {
	const direct = await readText(join(path, ".git", "config"));
	if (direct !== null) {
		return direct;
	}
	const pointer = await readText(join(path, ".git"));
	const gitdir = pointer?.match(/^gitdir:\s*(\S+)/)?.[1];
	if (gitdir === undefined) {
		return null;
	}
	const root = isAbsolute(gitdir) ? gitdir : resolve(path, gitdir);
	const common = await readText(join(root, "commondir"));
	const configDir = common === null ? root : resolve(root, common.trim());
	return readText(join(configDir, "config"));
}

async function worktreeList(path: string): Promise<{
	paths: string[];
	names: string[];
}> {
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
		return { paths: [], names: [] };
	}
	const [out, code] = await Promise.all([
		new Response(stdout).text(),
		proc.exited,
	]);
	if (code !== 0) {
		return { paths: [], names: [] };
	}
	const paths: string[] = [];
	const names: string[] = [];
	for (const line of out.split("\n")) {
		if (line.startsWith("worktree ")) {
			const listed = line.slice("worktree ".length).trim();
			paths.push(listed);
			names.push(basename(listed));
		} else if (line.startsWith("branch ")) {
			names.push(line.slice("branch refs/heads/".length).trim());
		}
	}
	return { paths, names };
}

const workcellState = z.object({
	status: z.string(),
	manager: z.string().optional(),
});

const agentList = z.object({
	result: z
		.object({
			agents: z.array(z.object({ name: z.string().optional() })),
		})
		.optional(),
});

const openRun = new Set(["running", "starting"]);

async function managerNames(
	env: Record<string, string | undefined>,
): Promise<Set<string> | null> {
	const herdr = Bun.which("herdr", { PATH: env.PATH ?? "" });
	if (herdr === null) {
		return null;
	}
	const listed = await command([herdr, "agent", "list"], env);
	if (listed === null) {
		return null;
	}
	let body: unknown;
	try {
		body = JSON.parse(listed);
	} catch {
		return null;
	}
	const parsed = agentList.safeParse(body);
	if (!parsed.success || parsed.data.result === undefined) {
		return null;
	}
	return new Set(
		parsed.data.result.agents.flatMap((agent) =>
			agent.name === undefined ? [] : [agent.name],
		),
	);
}

const issueToml = z.object({
	issue: z.string(),
});

const workcellToml = z
	.object({
		merge: z
			.object({
				auto: z.enum(["yes", "ask", "no"]),
			})
			.optional(),
	})
	.passthrough();

function workcellRun(
	text: string,
	key: string,
	agents: Set<string> | null,
): WorkcellRun | null {
	let parsed: ReturnType<typeof workcellState.safeParse>;
	try {
		parsed = workcellState.safeParse(JSON.parse(text));
	} catch {
		return null;
	}
	if (!parsed.success) {
		return null;
	}
	const manager = parsed.data.manager;
	const open = openRun.has(parsed.data.status);
	const stalled =
		open && agents !== null && manager !== undefined && !agents.has(manager);
	if (stalled || parsed.data.status === "failed") {
		return { key, status: "failed" };
	}
	if (open) {
		return { key, status: "running" };
	}
	return null;
}

function mergeAuto(text: string): AutoMerge | undefined {
	try {
		const parsed = workcellToml.safeParse(Bun.TOML.parse(text));
		return parsed.success ? parsed.data.merge?.auto : undefined;
	} catch {
		return undefined;
	}
}

function issueKey(text: string): string | null {
	let parsed: ReturnType<typeof issueToml.safeParse>;
	try {
		parsed = issueToml.safeParse(Bun.TOML.parse(text));
	} catch {
		return null;
	}
	if (!parsed.success) {
		return null;
	}
	const key = parsed.data.issue.trim();
	return key === "" ? null : key;
}

async function readCheckout(
	path: string,
	agents: Set<string> | null,
): Promise<LocalCheckout | null> {
	const configText = await gitConfigText(path);
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
	const issue = await readText(join(path, ".devkit", "issue.toml"));
	const key = issue === null ? null : issueKey(issue);
	const state = await readText(join(path, ".devkit", "workcell", "state.json"));
	const manifest = await readText(join(path, ".agents", "workcell.toml"));
	const auto = manifest === null ? undefined : mergeAuto(manifest);
	const run =
		key === null || state === null ? null : workcellRun(state, key, agents);
	if (kind === "linear") {
		const repo = origin?.repo;
		return {
			tracker: "linear",
			path,
			names: (await worktreeList(path)).names,
			...(run === null
				? {}
				: { runs: [repo === undefined ? run : { ...run, repo }] }),
			...(auto === undefined ? {} : { mergeAuto: auto }),
			...(repo === undefined ? {} : { repo }),
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
		names: [],
		...(run === null ? {} : { runs: [{ ...run, repo }] }),
		...(auto === undefined ? {} : { mergeAuto: auto }),
	};
}

function addCheckout(
	checkout: LocalCheckout,
	seen: Set<string>,
	found: LocalCheckout[],
): void {
	const id = `${checkout.tracker}:${checkout.path}`;
	if (seen.has(id)) {
		return;
	}
	seen.add(id);
	found.push(checkout);
}

export async function listDevkitCheckouts(
	roots: string[],
	env: Record<string, string | undefined> = process.env,
): Promise<LocalCheckout[]> {
	const agents = await managerNames(env);
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
				const checkout = await readCheckout(path, agents);
				if (checkout !== null) {
					addCheckout(checkout, seen, found);
				}
				await readWorktrees(path, seen, found, agents);
			}
		}
	}
	return found;
}

async function readWorktrees(
	path: string,
	seen: Set<string>,
	found: LocalCheckout[],
	agents: Set<string> | null,
): Promise<void> {
	const listed = await worktreeList(path);
	for (const worktree of listed.paths) {
		if (worktree === path) {
			continue;
		}
		const checkout = await readCheckout(worktree, agents);
		if (checkout === null) {
			continue;
		}
		addCheckout(checkout, seen, found);
	}
}

export async function listDevkitTodos(): Promise<string> {
	const devkit = Bun.which("devkit");
	if (devkit === null) {
		return "";
	}
	return (await command([devkit, "todo", "list", "--all"])) ?? "";
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

async function resolveToken(
	io: RunIo,
	envToken: string | null,
): Promise<string | null> {
	if (envToken !== null) {
		return envToken;
	}
	const fromGh = await io.readGhToken(io.env);
	if (fromGh === null || fromGh.trim() === "") {
		return null;
	}
	return fromGh;
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

	if (args.includes("--version")) {
		writeOut(version);
		return result(0);
	}

	const configFlag = flagValue(args, "--config");
	if (
		args.includes("--config") &&
		(configFlag === undefined || configFlag.trim() === "")
	) {
		writeErr("invalid configuration: --config needs a file path");
		return result(1);
	}

	const portFlag = flagValue(args, "--port");
	const hostFlag = flagValue(args, "--host");
	if (
		args.includes("--port") &&
		(portFlag === undefined || !/^\d+$/.test(portFlag))
	) {
		writeErr("invalid port: --port needs a port number");
		return result(1);
	}

	try {
		const configPath = (configFlag ?? defaultConfigPath(io.env)).trim();
		if (!existsSync(configPath)) {
			await mkdir(dirname(configPath), { recursive: true });
			await writeFile(configPath, "{}\n");
			writeErr(`created configuration file: ${configPath}`);
		}
		const configuration = await loadConfiguration(configPath);
		const fromEnv = io.env.GITHUB_TOKEN;
		const envToken =
			fromEnv !== undefined && fromEnv.trim() !== "" ? fromEnv : null;
		const token = await resolveToken(io, envToken);
		const linearKey = io.env.LINEAR_API_KEY?.trim() ?? "";
		const needsLinear = configuration.pinned.some(
			(pin) => pin.tracker === "linear",
		);
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
				io.listCheckouts ?? ((roots) => listDevkitCheckouts(roots, io.env)),
			...(io.now === undefined ? {} : { now: io.now }),
		});
		listened = true;
		writeOut(running.url.href);
		const credential = (async (): Promise<string | null> => {
			const warn = (message: string) => {
				writeErr(message);
				return null;
			};
			try {
				if (token !== null) {
					const user = await checkToken(token, io.fetch);
					if (user.status === 401) {
						return rejectedToken;
					}
					if (!user.ok) {
						return warn(`GitHub token check failed (HTTP ${user.status}).`);
					}
				}
				if (needsLinear && linearKey !== "") {
					const viewer = await checkLinearKey(linearKey, io.fetch);
					if (viewer.status === 401) {
						return rejectedLinearKey;
					}
					if (!viewer.ok) {
						return warn(`Linear key check failed (HTTP ${viewer.status}).`);
					}
				}
				return null;
			} catch (error) {
				return warn(
					error instanceof Error ? error.message : "credential check failed",
				);
			}
		})();
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

function configArgsForCheckout(args: string[], callerDir: string): string[] {
	const next = [...args];
	const index = next.indexOf("--config");
	const value = next[index + 1];
	if (index === -1 || value === undefined || value.trim() === "") {
		return next;
	}
	const trimmed = value.trim();
	if (isAbsolute(trimmed)) {
		next[index + 1] = trimmed;
		return next;
	}
	next[index + 1] = resolve(callerDir, trimmed);
	return next;
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
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: waitForStop(),
	});
	process.exit(result.exitCode);
}
