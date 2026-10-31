import { describe, expect, test } from "bun:test";

import type { ProjectReport, SettingsProject } from "../../src/domain.ts";
import issues from "../fixtures/forgejo-issues.json";
import { withApp } from "../project-harness.ts";
import { json } from "../support/fetch.ts";
import {
	env,
	host,
	hosts,
	linearWithCodeberg,
	rejected,
	repoApi,
	scratch,
	type Sent,
	tokenEnv,
} from "../support/forgejo.ts";
import { readOverview, readWhere, settledSettings } from "../support/reads.ts";

const pin = { tracker: "forgejo", repo: scratch, host };
const tracked = JSON.stringify({ hosts, tracked: [pin] });
const keyOf = (number: number) => `${scratch}#${number}`;

async function forgejoCard(base: string) {
	const { projects } = await readOverview(base);
	return projects.find((project) => project.tracker === "forgejo");
}

async function report(base: string): Promise<ProjectReport> {
	const name = `${host}/${scratch}`;
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}?view=all`, base),
	);
	return (await response.json()) as ProjectReport;
}

const withBody = (number: number, body: string) => () =>
	json(
		issues.map((issue) =>
			issue.number === number ? { ...issue, body } : issue,
		),
	);

describe("a tracked Forgejo repo", () => {
	test("shows its tickets in their states on the overview", async () => {
		const sent: Sent[] = [];
		await withApp(
			tracked,
			linearWithCodeberg(sent, {}, []),
			env,
			async (base) => {
				const card = await forgejoCard(base);
				expect(card?.error ?? null).toBeNull();
				expect(card?.name).toBe(`${host}/${scratch}`);
				expect(
					Object.fromEntries(
						(card?.tickets ?? []).map(({ key, state }) => [key, state]),
					),
				).toEqual({
					[keyOf(1)]: "backlog",
					[keyOf(2)]: "backlog",
					[keyOf(3)]: "backlog",
					[keyOf(4)]: "backlog",
					[keyOf(5)]: "backlog",
					[keyOf(6)]: "awaitingMerge",
					[keyOf(7)]: "inProgress",
					[keyOf(8)]: "inProgress",
					[keyOf(9)]: "done",
				});
				const reads = sent.filter(({ url }) => url.startsWith(repoApi));
				expect(
					reads.every(
						({ authorization }) => authorization === `token ${env[tokenEnv]}`,
					),
				).toBe(true);
				const ticket = (await report(base)).tickets.find(
					(item) => item.key === keyOf(1),
				);
				expect(ticket?.url).toBe(`https://${host}/${scratch}/issues/1`);
			},
		);
	});

	test("groups its tickets by milestone as workstreams", async () => {
		await withApp(
			tracked,
			linearWithCodeberg([], {}, []),
			env,
			async (base) => {
				const workstreams = Object.fromEntries(
					(await report(base)).tickets.map(({ key, workstream }) => [
						key,
						workstream,
					]),
				);
				for (const number of [1, 2, 3, 4, 5]) {
					expect(workstreams[keyOf(number)]).toBe("Workstream A");
				}
				expect(workstreams[keyOf(8)]).not.toBe("Workstream A");
			},
		);
	});

	test("shows a native dependency as a blocker link", async () => {
		await withApp(
			tracked,
			linearWithCodeberg([], {}, []),
			env,
			async (base) => {
				const shown = await report(base);
				const blocked = shown.tickets.find((item) => item.key === keyOf(5));
				expect(blocked?.blocked).toBe(true);
				expect(blocked?.blockedBy).toEqual([
					{
						tracker: "forgejo",
						project: `${host}/${scratch}`,
						key: keyOf(4),
						title: "fix(app): blocker ticket",
					},
				]);
				expect(
					shown.graphLinks.map(({ from, to }) => [from.key, to.key]),
				).toContainEqual([keyOf(4), keyOf(5)]);
			},
		);
	});

	test("reads a task list in a ticket body as its parent ticket frame", async () => {
		await withApp(
			tracked,
			linearWithCodeberg([], {}, []),
			env,
			async (base) => {
				const shown = await report(base);
				const ticket = (number: number) =>
					shown.tickets.find((item) => item.key === keyOf(number));
				expect(ticket(1)?.parent).toBe(keyOf(3));
				expect(ticket(2)?.parent).toBe(keyOf(3));
				expect(ticket(3)?.parent).toBeUndefined();
				expect(ticket(3)?.subTickets).toBe(2);
			},
		);
	});

	test("reads a blocker line in a ticket body as a ticket of the same tracker", async () => {
		await withApp(
			tracked,
			linearWithCodeberg(
				[],
				{ answers: { "/issues?": withBody(2, "Blocked by: #4") } },
				[],
			),
			env,
			async (base) => {
				const ticket = (await report(base)).tickets.find(
					(item) => item.key === keyOf(2),
				);
				expect(ticket?.blocked).toBe(true);
				expect(ticket?.blockedBy?.map(({ tracker }) => tracker)).toEqual([
					"forgejo",
				]);
			},
		);
	});

	test("shows an open PR with no ticket as an unlinked PR", async () => {
		await withApp(
			tracked,
			linearWithCodeberg([], {}, []),
			env,
			async (base) => {
				const card = await forgejoCard(base);
				expect(card?.unlinkedPrs).toEqual([
					expect.objectContaining({
						number: 12,
						repo: scratch,
						url: `https://${host}/${scratch}/pulls/12`,
					}),
				]);
			},
		);
	});

	test("reads the dependencies of an unchanged ticket once", async () => {
		const sent: Sent[] = [];
		await withApp(
			tracked,
			linearWithCodeberg(sent, {}, []),
			env,
			async (base) => {
				await forgejoCard(base);
				const reads = (start: string) =>
					sent.filter(({ url }) => url.startsWith(`${repoApi}${start}`)).length;
				const listed = reads("/issues?");
				await fetch(new URL("/api/refresh", base), { method: "POST" });
				await readWhere<{ polling?: true }>(
					new URL("/api/overview", base),
					(body) => body.polling !== true && reads("/issues?") > listed,
				);
				expect(reads("/issues/5/dependencies")).toBe(1);
			},
		);
	});

	test("gives sub-tickets with no milestone the workstream of their parent ticket", async () => {
		const noMilestones = () =>
			json(issues.map((issue) => ({ ...issue, milestone: null })));
		await withApp(
			tracked,
			linearWithCodeberg([], { answers: { "/issues?": noMilestones } }, []),
			env,
			async (base) => {
				const ticket = (await report(base)).tickets.find(
					(item) => item.key === keyOf(1),
				);
				expect(ticket?.workstream).toBe("feat(app): parent ticket");
			},
		);
	});

	test("offers no run start on its tickets", async () => {
		await withApp(
			JSON.stringify({
				hosts,
				tracked: [pin],
				factories: [
					{ name: "hub", url: "http://127.0.0.1:1", readyLabel: "ready" },
				],
			}),
			linearWithCodeberg([], {}, []),
			env,
			async (base) => {
				const { tickets } = await report(base);
				expect(tickets.length).toBeGreaterThan(0);
				expect(tickets.flatMap((ticket) => ticket.runStart ?? [])).toEqual([]);
			},
		);
	});
});

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
