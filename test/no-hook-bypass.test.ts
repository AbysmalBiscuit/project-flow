import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const script = join(
	import.meta.dir,
	"..",
	".agents",
	"plugins",
	"agent-guard",
	"tool_checks",
	"no_hook_bypass.py",
);
const message = "The hook is the gate. Report the failure to your PM and stop.";

const run = (tool: string, command?: string) => {
	const payload = command === undefined ? {} : { tool_input: { command } };
	return Bun.spawnSync(["python3", script, tool], {
		stdin: Buffer.from(JSON.stringify(payload)),
		stdout: "pipe",
		stderr: "pipe",
	});
};

const denied = [
	'git commit --no-verify -m "fix: x"',
	"git push --no-verify origin HEAD",
	"git commit -n -m x",
	"git commit -nm x",
	"git -c core.hooksPath=/tmp/empty commit -m x",
	"git -c core.hooksPath= commit -m x",
	"HUSKY=0 git commit -m x",
	"SKIP=pre-push git push",
	'bash -c "git push --no-verify"',
];

const silent = [
	'git commit -m "fix: -n flag"',
	"git push origin main",
	"git log -n 5",
	"git push -n",
	"git push --dry-run",
	"git status",
	"git commit -m 'SKIP=pre-push is the name'",
	'git commit -m "git commit -n"',
	"git -c user.name=fixture commit -m x",
	"HUSKY=1 git commit -m x",
	"FOO=SKIP git status",
	'git commit -m "subject" -m "- bullet one"',
	'git commit -m "subject" -m "-n now means dry run"',
	'git commit -m "-x and n"',
	"git commit --message=-n",
];

describe("no_hook_bypass", () => {
	test.each(denied)("denies %s", (command) => {
		const result = run("Bash", command);
		expect(result.exitCode).not.toBe(0);
		expect(result.exitCode).not.toBe(2);
		expect(result.stdout.toString()).toContain(message);
	});

	test.each(silent)("stays silent on %s", (command) => {
		const result = run("Bash", command);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe("");
	});

	test("stays silent on a non-shell tool", () => {
		const result = run("Edit", "git commit --no-verify");
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe("");
	});
});
