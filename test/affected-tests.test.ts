import { afterEach, describe, expect, test } from "bun:test";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const scripts = join(import.meta.dir, "..", "scripts");
const timeout = 30_000;
const slotScript = await readFile(join(scripts, "test-slot.sh"), "utf8");
const selectorScript = await readFile(
	join(scripts, "affected-tests.ts"),
	"utf8",
);

const testBody = (name: string) =>
	`import { test } from "bun:test";\nimport { appendFileSync } from "node:fs";\ntest("${name}", () => appendFileSync(process.env.RAN_LOG ?? "", "${name}\\n"));\n`;

const baseTree: Record<string, string> = {
	"package.json": `{ "name": "fixture", "private": true }\n`,
	"bunfig.toml": "[test]\n",
	"notes.md": "# fixture\n",
	"src/a.ts": "export const a = 1;\n",
	"src/b.ts": `#!/usr/bin/env bun\nimport { a } from "./a.ts";\nexport const b = a + 1;\n`,
	"src/tool.ts": "export {};\n",
	"test/support.ts": "export {};\n",
	"test/preload.ts": "export {};\n",
	"test/fixture-server.ts": "export {};\n",
	"test/proof-server.ts": "export {};\n",
	"test/b.test.ts": `import "../src/b.ts";\n${testBody("b")}`,
	"test/c.test.ts": testBody("c"),
	"test/tool.test.ts": `const tool = "src/tool.ts";\n${testBody("tool")}`,
};

// The fake records each slot that a run takes, then runs the command.
const fakeFlock = `#!/bin/sh\necho "$4" >> "$SLOT_LOG"\nshift 4\nexec "$@"\n`;

const cleanEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		([name]) => !name.startsWith("GIT_") && name !== "PROJECT_FLOW_FULL_SUITE",
	),
);

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function makeRepo() {
	const root = await mkdtemp(join(tmpdir(), "affected-tests-"));
	roots.push(root);
	const dir = join(root, "repo");
	const bin = join(root, "bin");
	await mkdir(bin);
	await writeFile(join(bin, "flock"), fakeFlock);
	await chmod(join(bin, "flock"), 0o755);

	const write = async (path: string, text: string) => {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), text);
	};
	const git = (...args: string[]) => {
		const result = Bun.spawnSync(
			[
				"git",
				"-c",
				"user.name=fixture",
				"-c",
				"user.email=fixture@example.com",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"core.hooksPath=/dev/null",
				...args,
			],
			{ cwd: dir, env: cleanEnv, stderr: "pipe" },
		);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr.toString());
		}
	};
	const commit = () => {
		git("add", "-A");
		git("commit", "-q", "-m", "change");
	};

	for (const [path, text] of Object.entries(baseTree)) {
		await write(path, text);
	}
	for (const script of ["affected-tests.ts", "test-slot.sh"]) {
		await mkdir(join(dir, "scripts"), { recursive: true });
		await copyFile(join(scripts, script), join(dir, "scripts", script));
	}
	git("init", "-q", "-b", "main");
	commit();
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("checkout", "-q", "-b", "work");

	const prePush = async (env: Record<string, string> = {}) => {
		const ranLog = join(root, "ran.log");
		const slotLog = join(root, "slot.log");
		await writeFile(ranLog, "");
		await writeFile(slotLog, "");
		const result = Bun.spawnSync(["sh", "scripts/test-slot.sh", "--affected"], {
			cwd: dir,
			env: {
				...cleanEnv,
				PATH: `${bin}:${process.env.PATH}`,
				RAN_LOG: ranLog,
				SLOT_LOG: slotLog,
				...env,
			},
			stderr: "pipe",
		});
		const lines = (path: string) =>
			readFile(path, "utf8").then((text) =>
				text.split("\n").filter((line) => line.length > 0),
			);
		return {
			exitCode: result.exitCode,
			selection: result.stderr
				.toString()
				.split("\n")
				.filter((line) => /^(run |full suite:|no test )/.test(line)),
			ran: (await lines(ranLog)).sort(),
			slots: (await lines(slotLog)).length,
		};
	};

	return { git, write, commit, prePush };
}

const allTests = ["b", "c", "tool"];

describe("the pre-push hook runs only the affected tests", () => {
	test(
		"a changed module runs the tests that reach it through imports",
		async () => {
			const repo = await makeRepo();
			await repo.write("src/a.ts", "export const a = 2;\n");
			repo.commit();

			expect(await repo.prePush()).toEqual({
				exitCode: 0,
				selection: ["run test/b.test.ts: reaches src/a.ts"],
				ran: ["b"],
				slots: 1,
			});
		},
		timeout,
	);

	test(
		"a module that a test names in its text runs that test",
		async () => {
			const repo = await makeRepo();
			await repo.write("src/tool.ts", "export const tool = 1;\n");

			expect(await repo.prePush()).toEqual({
				exitCode: 0,
				selection: ["run test/tool.test.ts: reaches src/tool.ts"],
				ran: ["tool"],
				slots: 1,
			});
		},
		timeout,
	);

	test(
		"a changed test file runs itself",
		async () => {
			const repo = await makeRepo();
			await repo.write("test/c.test.ts", `// edited\n${testBody("c")}`);

			expect(await repo.prePush()).toEqual({
				exitCode: 0,
				selection: ["run test/c.test.ts: changed"],
				ran: ["c"],
				slots: 1,
			});
		},
		timeout,
	);

	test(
		"docs and proof files run no tests",
		async () => {
			const repo = await makeRepo();
			await repo.write("notes.md", "# fixture, edited\n");
			await repo.write("scripts/proof-1.ts", "console.log('proof');\n");
			repo.commit();

			expect(await repo.prePush()).toEqual({
				exitCode: 0,
				selection: ["no test reaches this change: nothing to run"],
				ran: [],
				slots: 0,
			});
		},
		timeout,
	);

	test.each([
		[
			"test/support.ts",
			"export const edited = 1;\n",
			"a test helper or fixture",
		],
		[
			"test/preload.ts",
			"export const edited = 1;\n",
			"a test helper or fixture",
		],
		[
			"test/fixture-server.ts",
			"export const edited = 1;\n",
			"a test helper or fixture",
		],
		[
			"test/proof-server.ts",
			"export const edited = 1;\n",
			"a test helper or fixture",
		],
		["test/fixtures/issue.json", "{}\n", "a test helper or fixture"],
		["bunfig.toml", "# edited\n[test]\n", "a full-suite trigger"],
		["bun.lock", `{ "lockfileVersion": 1 }\n`, "a full-suite trigger"],
		[
			"package.json",
			`{ "name": "fixture-edited", "private": true }\n`,
			"a full-suite trigger",
		],
		["scripts/test-slot.sh", `${slotScript}# edited\n`, "a full-suite trigger"],
		[
			"scripts/affected-tests.ts",
			`${selectorScript}// edited\n`,
			"a full-suite trigger",
		],
	])(
		"a change to %s runs the full suite",
		async (path, text, reason) => {
			const repo = await makeRepo();
			await repo.write(path, text);
			repo.commit();

			expect(await repo.prePush()).toEqual({
				exitCode: 0,
				selection: [`full suite: ${path} is ${reason}`],
				ran: allTests,
				slots: 1,
			});
		},
		timeout,
	);

	test(
		"PROJECT_FLOW_FULL_SUITE=1 forces the full suite",
		async () => {
			const repo = await makeRepo();
			await repo.write("notes.md", "# fixture, edited\n");

			expect(await repo.prePush({ PROJECT_FLOW_FULL_SUITE: "1" })).toEqual({
				exitCode: 0,
				selection: ["full suite: PROJECT_FLOW_FULL_SUITE=1"],
				ran: allTests,
				slots: 1,
			});
		},
		timeout,
	);

	test(
		"a branch with no merge base runs the full suite",
		async () => {
			const repo = await makeRepo();
			repo.git("update-ref", "-d", "refs/remotes/origin/main");

			expect(await repo.prePush()).toEqual({
				exitCode: 0,
				selection: ["full suite: no merge base with origin/main"],
				ran: allTests,
				slots: 1,
			});
		},
		timeout,
	);

	test(
		"a branch behind main follows the rules on main",
		async () => {
			const repo = await makeRepo();
			repo.git("checkout", "-q", "main");
			await repo.write(
				"scripts/affected-tests.ts",
				selectorScript.replace(
					`"tsconfig.json",`,
					`"tsconfig.json",\n\t"docs/rules.md",`,
				),
			);
			repo.commit();
			repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
			repo.git("checkout", "-q", "work");
			await repo.write("docs/rules.md", "# rules\n");
			repo.commit();

			expect(await repo.prePush()).toEqual({
				exitCode: 0,
				selection: ["full suite: docs/rules.md is a full-suite trigger"],
				ran: allTests,
				slots: 1,
			});
		},
		timeout,
	);
});
