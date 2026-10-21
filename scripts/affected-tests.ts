// `scripts/test-slot.sh --affected` runs the copy of this file on origin/main,
// so it imports nothing from the repo.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const FULL_SUITE = 10;

const FULL_SUITE_TRIGGERS = new Set([
	".pre-commit-config.yaml",
	"bun.lock",
	"bunfig.toml",
	"devkit.toml",
	"package.json",
	"scripts/affected-tests.ts",
	"scripts/test-slot.sh",
	"tsconfig.json",
]);

const testFile = /^test\/.+\.test\.tsx?$/;
const scriptFile = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const scannedFile = /\.(ts|tsx|js|jsx|mjs|cjs|html)$/;
const fileName = /[\w.-]+\.[A-Za-z0-9]+/g;
const resolvedSuffixes = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts"];

function fullSuite(reason: string): never {
	console.error(`full suite: ${reason}`);
	process.exit(FULL_SUITE);
}

// A push hook exports GIT_DIR, which would point these calls elsewhere.
const gitEnv = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

function git(...args: string[]): string[] | null {
	const result = Bun.spawnSync(["git", ...args], {
		env: gitEnv,
		stderr: "ignore",
	});
	if (result.exitCode !== 0) {
		return null;
	}
	return result.stdout
		.toString()
		.split("\n")
		.filter((line) => line.length > 0);
}

if (process.env.PROJECT_FLOW_FULL_SUITE === "1") {
	fullSuite("PROJECT_FLOW_FULL_SUITE=1");
}

const base = git("merge-base", "HEAD", "origin/main")?.[0];
if (base === undefined) {
	fullSuite("no merge base with origin/main");
}

const untracked = git("ls-files", "--others", "--exclude-standard") ?? [];
const changed = [
	...new Set([
		...(git("diff", "--name-only", "--no-renames", base) ?? []),
		...untracked,
	]),
].sort();

for (const path of changed) {
	if (FULL_SUITE_TRIGGERS.has(path)) {
		fullSuite(`${path} is a full-suite trigger`);
	}
	if (path.startsWith("test/") && !testFile.test(path)) {
		fullSuite(`${path} is a test helper or fixture`);
	}
}

const files = [...new Set([...(git("ls-files") ?? []), ...untracked])].filter(
	(path) => existsSync(path),
);
// A deleted file stays a target, so its old importers still reach it.
const known = new Set([...files, ...changed]);
const byBasename = Map.groupBy(known, (path) => path.split("/").at(-1) ?? "");

function importedFiles(path: string, text: string): string[] {
	if (!scriptFile.test(path)) {
		return [];
	}
	const loader = path.endsWith("x") ? "tsx" : "ts";
	return new Bun.Transpiler({ loader })
		.scanImports(text.replace(/^#!.*/, ""))
		.filter((record) => record.path.startsWith("."))
		.flatMap((record) => {
			const target = normalize(join(dirname(path), record.path));
			const found = resolvedSuffixes
				.map((suffix) => target + suffix)
				.find((candidate) => known.has(candidate));
			return found === undefined ? [] : [found];
		});
}

// Each file points back at the files that import it or name it in text.
// A name catches a subprocess launch or a file read that no import shows.
const dependents = new Map<string, Set<string>>();
for (const path of files.filter((file) => scannedFile.test(file))) {
	const text = readFileSync(path, "utf8");
	const named = [...text.matchAll(fileName)].flatMap(
		([name]) => byBasename.get(name) ?? [],
	);
	for (const target of [...importedFiles(path, text), ...named]) {
		if (target === path) {
			continue;
		}
		const set = dependents.get(target) ?? new Set();
		set.add(path);
		dependents.set(target, set);
	}
}

const selected = new Map<string, string>();
for (const path of changed) {
	if (testFile.test(path) && existsSync(path)) {
		selected.set(path, "changed");
	}
}
for (const path of changed) {
	const queue = [path];
	const seen = new Set(queue);
	for (const current of queue) {
		for (const next of dependents.get(current) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	for (const reached of seen) {
		if (testFile.test(reached) && !selected.has(reached)) {
			selected.set(reached, `reaches ${path}`);
		}
	}
}

if (selected.size === 0) {
	console.error("no test reaches this change: nothing to run");
}
for (const [path, reason] of [...selected].sort(([a], [b]) =>
	a.localeCompare(b),
)) {
	console.error(`run ${path}: ${reason}`);
	console.log(`./${path}`);
}
