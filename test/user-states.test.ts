import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Configuration } from "../src/configuration.ts";
import { run } from "../src/main.ts";
import teamStates from "./fixtures/linear-team-states.json";
import {
	defaultStateColours,
	defaultStates,
	linearFake,
	tempConfig,
	testIo,
} from "./support.ts";

const linearSlug = "widget-launch";

type State = Configuration["states"][number];

type Report = {
	lanes: { id: string; name: string; colour: string; statusType: string }[];
	statuses: { name: string; statusType: string }[];
	sections: {
		id: string;
		items?: { key: string | null; lane?: string; state: string }[];
	}[];
};

type Settings = Configuration & {
	stateSources: { key: string; projects: string[]; statuses: string[] }[];
};

function linearIssue(
	identifier: string,
	title: string,
	state: { id: string; name: string; type: string; color: string },
	labels: string[] = [],
): Record<string, unknown> {
	return {
		identifier,
		title,
		description: "",
		updatedAt: "2026-08-18T12:00:00.000Z",
		state,
		parent: null,
		projectMilestone: null,
		labels: { nodes: labels.map((name) => ({ name })) },
	};
}

const issues = [
	linearIssue("WID-1", "Ship the list", {
		id: "cce36b04-d482-4233-b1d8-33eda76ca025",
		name: "In Progress",
		type: "started",
		color: "#f2c94c",
	}),
	linearIssue("WID-2", "Write the notes", {
		id: "364b3510-9325-4af6-9df1-8f2ff56f7a3d",
		name: "Todo",
		type: "unstarted",
		color: "#e2e2e2",
	}),
	linearIssue(
		"WID-3",
		"Check the copy",
		{
			id: "cce36b04-d482-4233-b1d8-33eda76ca025",
			name: "In Progress",
			type: "started",
			color: "#f2c94c",
		},
		["qa"],
	),
];

async function withApp(
	path: string,
	requests: string[],
	check: (base: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-states-"));
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			check(base).then(resolve).catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { LINEAR_API_KEY: "recorded-linear-key" },
				fetch: linearFake({
					project: {
						id: "project-widget",
						name: "Widget launch",
						slugId: linearSlug,
						teams: {
							nodes: [{ id: "team-widget", key: "WID", name: "Widget" }],
						},
					},
					issues,
					states: teamStates.data.team.states.nodes,
					requests,
				}),
				readGhToken: async () => null,
				listCheckouts: async () => [],
				databasePath: join(root, "store.sqlite"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function withConfig(
	body: Record<string, unknown>,
	check: (base: string, path: string, requests: string[]) => Promise<void>,
): Promise<void> {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			tracked: [{ tracker: "linear", project: linearSlug }],
			...body,
		}),
	);
	const requests: string[] = [];
	try {
		await withApp(path, requests, (base) => check(base, path, requests));
	} finally {
		await cleanup();
	}
}

async function settingsOf(base: string): Promise<Settings> {
	return (await (
		await fetch(new URL("/api/settings", base))
	).json()) as Settings;
}

function save(base: string, body: unknown): Promise<Response> {
	return fetch(new URL("/api/settings", base), {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function reportOf(base: string): Promise<Report> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent("Widget launch")}`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as Report;
}

function laneOf(report: Report, key: string): string | undefined {
	return report.sections
		.flatMap((section) => section.items ?? [])
		.find((item) => item.key === key)?.lane;
}

function categoryOf(report: Report, key: string): string | undefined {
	return report.sections
		.flatMap((section) => section.items ?? [])
		.find((item) => item.key === key)?.state;
}

async function writtenFile(path: string): Promise<Record<string, unknown>> {
	return JSON.parse(await Bun.file(path).text()) as Record<string, unknown>;
}

describe("user states", () => {
	test("the default states are the board columns of a tracker board", async () => {
		await withConfig({}, async (base, path) => {
			expect((await settingsOf(base)).states).toEqual(defaultStates);
			expect((await writtenFile(path)).states).toEqual(defaultStates);
			const report = await reportOf(base);
			expect(report.lanes.map((lane) => lane.name)).toEqual(
				defaultStates.map((state) => state.label),
			);
			expect(report.statuses.map((status) => status.name)).toContain("Todo");
			expect(laneOf(report, "WID-1")).toBe("In progress");
			expect(laneOf(report, "WID-2")).toBe("Backlog");
		});
	});

	test("settings list the statuses of each source to map", async () => {
		await withConfig({}, async (base) => {
			const source = (await settingsOf(base)).stateSources.find(
				(item) => item.key === "WID",
			);
			expect(source?.statuses).toEqual(
				teamStates.data.team.states.nodes
					.toSorted((left, right) => left.position - right.position)
					.map((state) => state.name),
			);
			expect(source?.projects).toEqual(["Widget launch"]);
		});
	});

	test("an added state takes the tracker statuses and labels mapped to it, at its place in the order", async () => {
		await withConfig({}, async (base, path, requests) => {
			const before = await settingsOf(base);
			const ready: State = {
				id: "ready",
				label: "Ready",
				colour: "#123456",
				categories: [],
			};
			const qa: State = {
				id: "qa",
				label: "QA",
				colour: "#AA00CC",
				categories: [],
			};
			const [first, ...rest] = before.states;
			if (first === undefined) {
				throw new Error("no default state");
			}
			const sent = requests.length;
			const saved = await save(base, {
				...before,
				states: [first, ready, ...rest, qa],
				stateMappings: { WID: { Todo: "ready", qa: "qa" } },
			});
			expect(saved.status).toBe(200);
			expect(requests.length).toBe(sent);
			const report = await reportOf(base);
			expect(report.lanes.map((lane) => lane.name)).toEqual([
				"Backlog",
				"Ready",
				"In progress",
				"In review",
				"Awaiting merge",
				"Done",
				"Dropped",
				"QA",
			]);
			expect(report.lanes.find((lane) => lane.name === "QA")?.colour).toBe(
				"#aa00cc",
			);
			expect(laneOf(report, "WID-1")).toBe("In progress");
			expect(laneOf(report, "WID-2")).toBe("Ready");
			expect(laneOf(report, "WID-3")).toBe("QA");
			expect(categoryOf(report, "WID-2")).toBe("backlog");
			expect(categoryOf(report, "WID-3")).toBe("inProgress");
			const file = await writtenFile(path);
			expect(file.stateMappings).toEqual({
				WID: { Todo: "ready", qa: "qa" },
			});
			expect(file.states).toEqual([
				first,
				ready,
				...rest,
				{ ...qa, colour: "#aa00cc" },
			]);
		});
	});

	test("a renamed and recoloured state keeps its tickets and reaches the page", async () => {
		await withConfig({}, async (base, path) => {
			const before = await settingsOf(base);
			const states = before.states.map((state) =>
				state.id === "inProgress"
					? { ...state, label: "Doing", colour: "#FF0066" }
					: state,
			);
			const saved = await save(base, { ...before, states });
			expect(saved.status).toBe(200);
			const report = await reportOf(base);
			expect(report.lanes.find((lane) => lane.id === "inProgress")).toEqual({
				id: "inProgress",
				name: "Doing",
				colour: "#ff0066",
				statusType: "inProgress",
			});
			expect(laneOf(report, "WID-1")).toBe("Doing");
			const page = await (await fetch(new URL("/", base))).text();
			expect(page).toContain('"inProgress":"#ff0066"');
			const file = await writtenFile(path);
			expect(file.states).toEqual(
				states.map((state) =>
					state.id === "inProgress" ? { ...state, colour: "#ff0066" } : state,
				),
			);
		});
	});

	test("a removed state's tickets move to the state that takes its categories", async () => {
		await withConfig(
			{ stateMappings: { WID: { Todo: "backlog" } } },
			async (base) => {
				const before = await settingsOf(base);
				const states = before.states.flatMap((state) =>
					state.id === "backlog"
						? []
						: state.id === "inProgress"
							? [{ ...state, categories: ["backlog", "inProgress"] }]
							: [state],
				);
				const saved = await save(base, { ...before, states });
				expect(saved.status).toBe(200);
				const report = await reportOf(base);
				expect(report.lanes.map((lane) => lane.name)).not.toContain("Backlog");
				expect(laneOf(report, "WID-2")).toBe("In progress");
				expect(categoryOf(report, "WID-2")).toBe("backlog");
			},
		);
	});

	test("a state list that leaves a category without a state names the field and leaves the file", async () => {
		await withConfig({}, async (base, path) => {
			const before = await settingsOf(base);
			const lists: unknown[] = [
				before.states.filter((state) => state.id !== "backlog"),
				[],
				[...before.states, { ...defaultStates[0], label: "Other" }],
				[...before.states, { ...defaultStates[0], id: "other" }],
				before.states.map((state) =>
					state.id === "done" ? { ...state, colour: "red" } : state,
				),
				before.states.map((state) =>
					state.id === "done" ? { ...state, label: "  " } : state,
				),
			];
			for (const states of lists) {
				const saved = await save(base, { ...before, states });
				expect(saved.status).toBe(400);
				const body = (await saved.json()) as { error: string };
				expect(body.error).toContain("states");
			}
			expect((await writtenFile(path)).states).toEqual(defaultStates);
		});
	});

	test("an old file with state colours starts with the default states in those colours", async () => {
		await withConfig(
			{ stateColours: { ...defaultStateColours, done: "#123456" } },
			async (base, path) => {
				const expected = defaultStates.map((state) =>
					state.id === "done" ? { ...state, colour: "#123456" } : state,
				);
				expect((await settingsOf(base)).states).toEqual(expected);
				const file = await writtenFile(path);
				expect(file.states).toEqual(expected);
				expect(file.stateColours).toBeUndefined();
			},
		);
	});
});
