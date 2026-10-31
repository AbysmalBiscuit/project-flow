import { describe, expect, test } from "bun:test";

import type { SettingsProject } from "../../src/domain.ts";
import { withApp } from "../project-harness.ts";
import {
	env,
	host,
	hosts,
	linearWithCodeberg,
	rejected,
	scratch,
	type Sent,
	tokenEnv,
} from "../support/forgejo.ts";
import { readOverview, settledSettings } from "../support/reads.ts";
import {
	forgejoCard,
	forgejoPin as pin,
	forgejoTracked as tracked,
} from "./_support.ts";

describe("the token of a tracked Forgejo repo", () => {
	test("a missing token names its env var on the project and sends no request", async () => {
		const sent: Sent[] = [];
		const { [tokenEnv]: _token, ...withoutToken } = env;
		await withApp(
			tracked,
			linearWithCodeberg(sent, {}, []),
			withoutToken,
			async (base) => {
				expect((await forgejoCard(base))?.error).toBe(
					`${tokenEnv} is missing: set ${tokenEnv} to read ${host}.`,
				);
				expect(sent.some(({ url }) => url.startsWith(`https://${host}/`))).toBe(
					false,
				);
			},
		);
	});

	test("a token that the issue read rejects names its env var on the project", async () => {
		await withApp(
			JSON.stringify({
				hosts,
				tracked: [pin, { tracker: "github", repo: "acme/widget" }],
			}),
			linearWithCodeberg([], { answers: { "/issues?": rejected } }, []),
			env,
			async (base) => {
				expect((await forgejoCard(base))?.error).toBe(
					`${tokenEnv} was rejected by ${host} (HTTP 401): set a valid token.`,
				);
			},
		);
	});
});

describe("Settings on a declared Forgejo host", () => {
	test("a failed repo discovery shows in Settings and keeps the pinned repo fresh", async () => {
		await withApp(
			tracked,
			linearWithCodeberg([], { reposStatus: 500 }, []),
			env,
			async (base) => {
				const overview = await readOverview(base);
				expect(overview.error).toBeNull();
				const card = overview.projects.find(
					(project) => project.tracker === "forgejo",
				);
				expect(card?.error).toBeNull();
				const { discoveryErrors } = await settledSettings<{
					discoveryErrors: string[];
				}>(base);
				expect(discoveryErrors).toEqual([
					`Forgejo find repos failed (HTTP 500): https://${host}/api/v1/user/repos?limit=50`,
				]);
			},
		);
	});

	test("lists each found repo with the pin that tracks it", async () => {
		await withApp(
			JSON.stringify({ hosts }),
			linearWithCodeberg([], {}, []),
			env,
			async (base) => {
				const settings = await settledSettings<{
					projects: SettingsProject[];
					trackers: { kind: string }[];
				}>(base);
				expect(settings.trackers.map(({ kind }) => kind)).toContain("forgejo");
				expect(
					settings.projects.find((item) => item.tracker === "forgejo"),
				).toMatchObject({
					key: `${host}/${scratch}`,
					source: "found",
					tracked: false,
					ref: pin,
				});
			},
		);
	});

	test("a pin in another case names the found repo", async () => {
		await withApp(
			JSON.stringify({
				hosts,
				tracked: [{ ...pin, repo: scratch.toLowerCase() }],
			}),
			linearWithCodeberg([], {}, []),
			env,
			async (base) => {
				const { projects } = await settledSettings<{
					projects: SettingsProject[];
				}>(base);
				const rows = projects.filter((item) => item.tracker === "forgejo");
				expect(rows).toHaveLength(1);
				expect(rows[0]?.tracked).toBe(true);
			},
		);
	});

	test("a configuration with no Forgejo host lists no Forgejo tracker", async () => {
		await withApp(
			JSON.stringify({}),
			linearWithCodeberg([], {}, []),
			env,
			async (base) => {
				const settings = await settledSettings<{
					trackers: { kind: string }[];
				}>(base);
				expect(settings.trackers.map(({ kind }) => kind)).not.toContain(
					"forgejo",
				);
			},
		);
	});
});
