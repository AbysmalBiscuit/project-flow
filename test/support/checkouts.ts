import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AutoMerge } from "../../src/configuration.ts";
import { repo as githubRepo } from "./github.ts";

const fixtureDir = join(import.meta.dir, "..", "fixtures");

export async function git(args: string[], cwd: string): Promise<string> {
	const proc = Bun.spawn(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_DIR: undefined,
			GIT_WORK_TREE: undefined,
			GIT_AUTHOR_NAME: "dev",
			GIT_AUTHOR_EMAIL: "dev@example.com",
			GIT_COMMITTER_NAME: "dev",
			GIT_COMMITTER_EMAIL: "dev@example.com",
		},
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${err || out}`);
	}
	return out;
}

export async function devkitWorktree(options: {
	key: string;
	status: "running" | "starting" | "failed";
	mergeAuto?: { merge?: AutoMerge; workflow?: AutoMerge };
	repo?: string;
	manager?: string;
}): Promise<{ root: string; cleanup: () => Promise<void> }> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-checkout-"));
	const main = join(root, "acme", "widget");
	const worktree = join(
		root,
		"acme",
		"widget_workspaces",
		`${options.key.replaceAll("/", "-")}-feat`,
	);
	await mkdir(main, { recursive: true });
	await git(["init", "-b", "main"], main);
	await git(["commit", "--allow-empty", "-m", "init"], main);
	const repo = options.repo ?? githubRepo;
	await writeFile(
		join(main, "devkit.toml"),
		`[tracker]\nkind = "github"\n\n[github]\nissues_repo = "${repo}"\n`,
	);
	await writeFile(
		join(main, ".git", "config"),
		`${await readFile(join(main, ".git", "config"), "utf8")}[remote "origin"]\n\turl = https://github.com/${repo}.git\n`,
	);
	await mkdir(join(root, "acme", "widget_workspaces"), { recursive: true });
	await git(["worktree", "add", "-b", "run", worktree], main);
	const issue = await readFile(join(fixtureDir, "issue.toml"), "utf8");
	await mkdir(join(worktree, ".devkit", "workcell"), { recursive: true });
	await writeFile(
		join(worktree, ".devkit", "issue.toml"),
		issue.replace(/^issue = ".*"$/m, `issue = "${options.key}"`),
	);
	const recorded = JSON.parse(
		await readFile(
			join(
				fixtureDir,
				options.status === "failed"
					? "state-failed.json"
					: "state-running.json",
			),
			"utf8",
		),
	) as { status: string };
	await writeFile(
		join(worktree, ".devkit", "workcell", "state.json"),
		JSON.stringify({
			...recorded,
			status: options.status,
			...(options.manager === undefined ? {} : { manager: options.manager }),
		}),
	);
	if (options.mergeAuto !== undefined) {
		const { merge, workflow } = options.mergeAuto;
		const manifest = await readFile(join(fixtureDir, "workcell.toml"), "utf8");
		await mkdir(join(worktree, ".agents"), { recursive: true });
		await writeFile(
			join(worktree, ".agents", "workcell.toml"),
			manifest
				.replace(
					/^merge_auto = ".*"\n/m,
					workflow === undefined ? "" : `merge_auto = "${workflow}"\n`,
				)
				.replace(
					/^\[merge\]\n/m,
					merge === undefined ? "[merge]\n" : `[merge]\nauto = "${merge}"\n`,
				),
		);
	}
	const listed = await git(["worktree", "list", "--porcelain"], main);
	if (!listed.includes(worktree)) {
		throw new Error(`worktree list missed ${worktree}: ${listed}`);
	}
	return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
