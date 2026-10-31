import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

import { command } from "./command.ts";
import type { AutoMerge } from "./configuration.ts";
import { autoMerge } from "./configuration.ts";
import type { LocalCheckout, WorkcellRun } from "./ports.ts";
import { ownerRepo } from "./project-ref.ts";

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
	const out = await command(
		["git", "-C", path, "worktree", "list", "--porcelain"],
		{ ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
	);
	if (out === null) {
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
		merge: z.object({ auto: autoMerge.optional() }).optional(),
		standard: z
			.object({
				parameters: z.object({ merge_auto: autoMerge.optional() }).optional(),
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
		if (!parsed.success) {
			return undefined;
		}
		return (
			parsed.data.standard?.parameters?.merge_auto ?? parsed.data.merge?.auto
		);
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
