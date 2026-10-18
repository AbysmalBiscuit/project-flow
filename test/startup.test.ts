import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import {
	missingToken,
	readGhAuthToken,
	rejectedToken,
	run,
} from "../src/main.ts";
import { tempConfig, urlOf } from "./support.ts";

const valid = JSON.stringify({
	pinned: [{ tracker: "github", repo: "acme/widget" }],
});

function recordedFetch(userStatus: number): Fetch {
	return async (input) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ message: "recorded" }), {
				status: userStatus,
			});
		}
		if (url.includes("/issues?")) {
			return new Response("[]", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return new Response("not recorded", { status: 404 });
	};
}

describe("startup", () => {
	test("a missing token exits 1 and names GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(["--config", path], {
				env: {},
				fetch: recordedFetch(401),
				readGhToken: async () => null,
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(missingToken);
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a missing gh executable exits 1 and names GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const bin = await mkdtemp(join(tmpdir(), "project-flow-no-gh-"));
		try {
			const result = await run(["--config", path], {
				env: { PATH: bin },
				fetch: recordedFetch(200),
				readGhToken: readGhAuthToken,
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(missingToken);
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
			await rm(bin, { recursive: true, force: true });
		}
	});

	test("a rejected token exits 1 and names GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(["--config", path], {
				env: { GITHUB_TOKEN: "rejected-token" },
				fetch: recordedFetch(401),
				readGhToken: async () => {
					throw new Error("gh must not run when GITHUB_TOKEN is set");
				},
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(rejectedToken);
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a non-ok token check exits 1 and names the status", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(["--config", path], {
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(500),
				readGhToken: async () => null,
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a blank --config exits 1 and does not listen", async () => {
		const result = await run(["--config", "   "], {
			env: { GITHUB_TOKEN: "recorded-token" },
			fetch: recordedFetch(200),
			readGhToken: async () => null,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--config");
		expect(result.listened).toBe(false);
	});

	test("an empty --config exits 1 and does not listen", async () => {
		const result = await run(["--config"], {
			env: { GITHUB_TOKEN: "recorded-token" },
			fetch: recordedFetch(200),
			readGhToken: async () => null,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--config");
		expect(result.listened).toBe(false);
	});

	test("repeated spaces in --config still name the missing file", async () => {
		const result = await run(["--config", "  /tmp/no such file  "], {
			env: { GITHUB_TOKEN: "recorded-token" },
			fetch: recordedFetch(200),
			readGhToken: async () => null,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("configuration file is missing");
		expect(result.listened).toBe(false);
	});

	test("a blank GITHUB_TOKEN exits 1 and names the token", async () => {
		const result = await run(["--config", "/tmp/unused-config.json"], {
			env: { GITHUB_TOKEN: "   " },
			fetch: recordedFetch(200),
			readGhToken: async () => null,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(missingToken);
		expect(result.listened).toBe(false);
	});

	test("an empty --port exits 1 and does not listen", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(["--config", path, "--port"], {
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("--port");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a non-numeric --port exits 1 and does not listen", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(["--config", path, "--port", "nope"], {
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("--port");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("an invalid configuration exits 1 and names the field", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget", extra: true }],
			}),
		);
		try {
			const result = await run(["--config", path], {
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pinned.0.extra");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a missing store directory is created for the run", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-data-"));
		const databasePath = join(root, "missing", "project-flow.sqlite");
		try {
			const result = await run(["--config", path], {
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
				databasePath,
				waitForStop: Promise.resolve(),
			});
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await Bun.file(databasePath).exists()).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
