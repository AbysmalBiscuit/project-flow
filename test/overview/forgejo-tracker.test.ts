import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../../src/domain.ts";
import dependencies5 from "../fixtures/forgejo-issue-5-dependencies.json";
import issues from "../fixtures/forgejo-issues.json";
import openPulls from "../fixtures/forgejo-open-pulls.json";
import { withApp } from "../project-harness.ts";
import { json, urlOf } from "../support/fetch.ts";
import {
	codeberg,
	env,
	host,
	hosts,
	linearWithCodeberg,
	repoApi,
	scratch,
	type Sent,
	tokenEnv,
} from "../support/forgejo.ts";
import { readWhere } from "../support/reads.ts";
import {
	forgejoCard,
	forgejoPin as pin,
	forgejoTracked as tracked,
} from "./_support.ts";

const keyOf = (number: number) => `${host}/${scratch}#${number}`;

async function report(
	base: string,
	name = `${host}/${scratch}`,
): Promise<ProjectReport> {
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

	test("reads the dependencies of an unchanged ticket again only when it has blockers", async () => {
		const sent: Sent[] = [];
		await withApp(
			tracked,
			linearWithCodeberg(sent, {}, []),
			env,
			async (base) => {
				await forgejoCard(base);
				const reads = (start: string) =>
					sent.filter(({ url }) => url.startsWith(`${repoApi}${start}`)).length;
				await fetch(new URL("/api/refresh", base), { method: "POST" });
				await readWhere<{ polling?: true }>(
					new URL("/api/overview", base),
					(body) =>
						body.polling !== true && reads("/issues/5/dependencies") > 1,
				);
				expect(reads("/issues/4/dependencies")).toBe(1);
			},
		);
	});

	test("drops a blocker in another repo that closes while the blocked ticket stays unchanged", async () => {
		const [blocker] = dependencies5;
		let state = "open";
		await withApp(
			tracked,
			linearWithCodeberg(
				[],
				{
					answers: {
						"/issues/5/dependencies": () =>
							json([
								{
									...blocker,
									state,
									repository: { full_name: "AbysmalBiscuit/other" },
								},
							]),
					},
				},
				[],
			),
			env,
			async (base) => {
				const name = encodeURIComponent(`${host}/${scratch}`);
				const url = new URL(`/api/projects/${name}?view=all`, base);
				const blocked = (shown: ProjectReport) =>
					shown.tickets.find((item) => item.key === keyOf(5))?.blocked;
				expect(blocked(await report(base))).toBe(true);
				state = "closed";
				await fetch(new URL("/api/refresh", base), { method: "POST" });
				const after = await readWhere<ProjectReport>(
					url,
					(shown) => blocked(shown) !== true,
				);
				expect(blocked(after)).not.toBe(true);
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

	test("neither offers nor queues a run start on a ticket with the ready label", async () => {
		await withApp(
			JSON.stringify({
				hosts,
				tracked: [pin],
				factories: [
					{ name: "hub", url: "http://127.0.0.1:1", readyLabel: "ready" },
				],
			}),
			linearWithCodeberg(
				[],
				{
					answers: {
						"/issues?": () =>
							json(
								issues.map((issue) =>
									issue.number === 2
										? { ...issue, labels: [{ name: "ready" }] }
										: issue,
								),
							),
					},
				},
				[],
			),
			env,
			async (base) => {
				const ticket = (await report(base)).tickets.find(
					(item) => item.key === keyOf(2),
				);
				expect(ticket).toBeDefined();
				expect(ticket?.runStart).toBeUndefined();
				expect(ticket?.queued).toBeUndefined();
			},
		);
	});
});

describe("Forgejo tickets on two hosts", () => {
	const acme = "git.acme.dev";
	const keyOn = (on: string, number: number) => `${on}/${scratch}#${number}`;

	test("keep the blockers of each host apart when the repo names match", async () => {
		const codebergOnly = linearWithCodeberg([], {}, []);
		await withApp(
			JSON.stringify({
				hosts: [...hosts, { host: acme, forge: "forgejo", tokenEnv }],
				tracked: [pin, { ...pin, host: acme }],
			}),
			async (input, init) => {
				const url = urlOf(input);
				if (!url.startsWith(`https://${acme}/`)) {
					return codebergOnly(input, init);
				}
				const path = url.slice(`https://${acme}`.length);
				return path.includes("/issues/5/dependencies")
					? json([])
					: (codeberg(`https://${host}${path}`, {}) ?? json([], 404));
			},
			env,
			async (base) => {
				const blockedBy = async (on: string) =>
					(await report(base, `${on}/${scratch}`)).tickets
						.find((item) => item.key === keyOn(on, 5))
						?.blockedBy?.map(({ key }) => key);
				expect(await blockedBy(host)).toEqual([keyOn(host, 4)]);
				expect(await blockedBy(acme)).toEqual([]);
			},
		);
	});
});

describe("an issue URL in a Forgejo ticket body", () => {
	test("names a ticket only on the host of that ticket", async () => {
		const bodies = () =>
			json(
				issues.map((issue) =>
					issue.number === 1
						? {
								...issue,
								body: `Blocked by: https://${host}/${scratch}/issues/4`,
							}
						: issue.number === 2
							? {
									...issue,
									body: `Blocked by: https://other.example/${scratch}/issues/4`,
								}
							: issue,
				),
			);
		await withApp(
			tracked,
			linearWithCodeberg([], { answers: { "/issues?": bodies } }, []),
			env,
			async (base) => {
				const blocked = (await report(base)).tickets.flatMap((item) =>
					item.blocked === true ? [item.key] : [],
				);
				expect(blocked).toContain(keyOf(1));
				expect(blocked).not.toContain(keyOf(2));
			},
		);
	});
});

describe("a Forgejo PR whose branch names no ticket", () => {
	test("moves the ticket that its body closes", async () => {
		const renamed = () =>
			json(
				openPulls.map((pull) =>
					pull.number === 10
						? { ...pull, head: { ...pull.head, ref: "export-page" } }
						: pull,
				),
			);
		await withApp(
			tracked,
			linearWithCodeberg([], { answers: { "/pulls?state=open": renamed } }, []),
			env,
			async (base) => {
				const ticket = (await report(base)).tickets.find(
					(item) => item.key === keyOf(6),
				);
				expect(ticket?.state).toBe("awaitingMerge");
			},
		);
	});

	test("makes the ticket that a merged PR body closes done", async () => {
		const [pull] = openPulls.filter((item) => item.number === 10);
		const merged = () =>
			json([
				{
					...pull,
					state: "closed",
					merged: true,
					body: "Closes #2",
					head: { ...pull?.head, ref: "export-page" },
				},
			]);
		await withApp(
			tracked,
			linearWithCodeberg(
				[],
				{
					answers: {
						"/pulls?state=open": () => json([]),
						"/pulls?state=closed": merged,
					},
				},
				[],
			),
			env,
			async (base) => {
				const ticket = (await report(base)).tickets.find(
					(item) => item.key === keyOf(2),
				);
				expect(ticket?.state).toBe("done");
			},
		);
	});
});
