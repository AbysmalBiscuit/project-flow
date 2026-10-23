import { afterAll, describe, expect, test } from "bun:test";
import ELK from "elkjs/lib/elk-api.js";
import { fillShare } from "../proof/elk-spike/handwritten.ts";
import type { ProjectReport } from "../src/domain.ts";
import { projectNodeId } from "../src/graph-flow.ts";
import {
	frameId,
	type GraphLayout,
	groupHead,
	groupId,
	groupPad,
	type LayoutInput,
	layoutGraph,
	layoutInput,
	type Rect,
} from "../src/graph-layout.ts";
import { linearSlug, withApp } from "./project-harness.ts";
import { linearFake } from "./support.ts";

const elk = new ELK({
	workerFactory: () =>
		new Worker(require.resolve("elkjs/lib/elk-worker.min.js")),
});
afterAll(() => elk.terminateWorker());

const card = { width: 220, height: 96 };
const workcell = (await Bun.file(
	new URL("./fixtures/workcell-graph-report.json", import.meta.url),
).json()) as ProjectReport;

async function workcellLayout(direction: "left-to-right" | "top-to-bottom") {
	const input = layoutInput(workcell, "workstream", []);
	const layout = await layoutGraph(
		elk,
		input,
		direction,
		card,
		() => 0,
		() => 0,
	);
	return { input, layout };
}

const linearTicket = (
	id: string,
	title: string,
	state: "unstarted" | "completed",
	parent: string | null,
	blocks: string[] = [],
	milestone = "Beta",
) => ({
	id,
	identifier: id,
	title,
	description: "",
	state: { type: state },
	updatedAt: "2026-10-21T12:00:00.000Z",
	projectMilestone: { name: milestone },
	labels: { nodes: [] },
	parent: parent === null ? null : { identifier: parent },
	inverseRelations: {
		nodes: blocks.map((blocker) => ({
			type: "blocks",
			issue: {
				identifier: blocker,
				title: blocker,
				state: { type: "unstarted" },
				project: { slugId: linearSlug },
			},
		})),
	},
});

// Four ticket levels under WID-1, two sibling parent tickets at each of the
// two upper levels, and blocker arrows that cross frame borders.
const hierarchy = [
	linearTicket("WID-1", "Ship the widget", "unstarted", null),
	linearTicket("WID-2", "Paint the list", "unstarted", "WID-1"),
	linearTicket("WID-3", "Paint the rows", "unstarted", "WID-2"),
	linearTicket("WID-4", "Paint the cells", "unstarted", "WID-3"),
	linearTicket("WID-5", "Paint the borders", "unstarted", "WID-3", ["WID-8"]),
	linearTicket("WID-6", "Size the cells", "unstarted", "WID-2"),
	linearTicket("WID-7", "Sort the list", "unstarted", "WID-1"),
	linearTicket("WID-8", "Sort by name", "unstarted", "WID-7"),
	linearTicket("WID-9", "Sort by date", "unstarted", "WID-7", ["WID-6"]),
	linearTicket("WID-10", "Move the archive", "unstarted", null),
	linearTicket("WID-11", "Copy the archive", "unstarted", "WID-10", ["WID-4"]),
	linearTicket("WID-12", "Check the copies", "unstarted", "WID-10"),
	linearTicket("WID-20", "Write the runbook", "unstarted", null),
];

// WID-1 and WID-2 sit in Beta, while the WID-3 chain below WID-1 sits in Gamma.
const milestones = [
	linearTicket("WID-1", "Ship the widget", "unstarted", null),
	linearTicket("WID-2", "Paint the list", "unstarted", "WID-1"),
	linearTicket("WID-3", "Sort the list", "unstarted", "WID-1", [], "Gamma"),
	linearTicket("WID-4", "Sort by name", "unstarted", "WID-3", [], "Gamma"),
];

async function hierarchyReport(
	search: string,
	issues = hierarchy,
): Promise<ProjectReport> {
	let report: ProjectReport | null = null;
	await withApp(
		JSON.stringify({
			pinned: [{ tracker: "linear", project: linearSlug }],
			projectViews: { "Widget launch": { search } },
		}),
		linearFake({
			project: {
				id: "project-widget",
				name: "Widget launch",
				slugId: linearSlug,
			},
			issues,
		}),
		{ LINEAR_API_KEY: "recorded-linear-key" },
		async (base) => {
			report = (await (
				await fetch(new URL("/api/projects/Widget%20launch", base))
			).json()) as ProjectReport;
		},
	);
	if (report === null) {
		throw new Error("the project report did not load");
	}
	return report;
}

const cardOf = (key: string) => projectNodeId("Widget launch", key);
const frameOfKey = (key: string) => frameId(cardOf(key));

function inside(inner: Rect, outer: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

/** Each ticket key with the parent ticket keys above it, nearest first. */
const chains: Record<string, string[]> = {
	"WID-2": ["WID-1"],
	"WID-3": ["WID-2", "WID-1"],
	"WID-4": ["WID-3", "WID-2", "WID-1"],
	"WID-5": ["WID-3", "WID-2", "WID-1"],
	"WID-6": ["WID-2", "WID-1"],
	"WID-7": ["WID-1"],
	"WID-8": ["WID-7", "WID-1"],
	"WID-9": ["WID-7", "WID-1"],
	"WID-11": ["WID-10"],
	"WID-12": ["WID-10"],
};

/** Each card that sits outside a frame it belongs in, as `card / frame`. */
function strayCards(layout: GraphLayout, keys: readonly string[]): string[] {
	return keys.flatMap((key) => {
		const place = layout.cards.get(cardOf(key));
		if (place === undefined) {
			return [`${key} / no card`];
		}
		const box = { ...place, ...card };
		return (chains[key] ?? []).flatMap((parent) => {
			const frame = layout.frames.get(frameOfKey(parent));
			return frame !== undefined && inside(box, frame)
				? []
				: [`${key} / ${parent}`];
		});
	});
}

function frameOverlaps(input: LayoutInput, layout: GraphLayout): string[] {
	const frames = input.frames.flatMap((frame) => {
		const box = layout.frames.get(frame.id);
		return box === undefined ? [] : [{ frame, box }];
	});
	return frames.flatMap((left, index) =>
		frames
			.slice(index + 1)
			.filter(
				(right) =>
					right.frame.parent === left.frame.parent &&
					overlap(left.box, right.box),
			)
			.map((right) => `${left.frame.head} / ${right.frame.head}`),
	);
}

function overlap(left: Rect, right: Rect): boolean {
	return (
		left.x < right.x + right.width &&
		right.x < left.x + left.width &&
		left.y < right.y + right.height &&
		right.y < left.y + left.height
	);
}

describe("project graph layout", () => {
	test("each workcell workstream frame fills at least the share the elkjs spike recorded", async () => {
		// `proof/elk-spike/measure.ts` prints these shares for ELK `layered` again.
		const recorded: Record<string, number> = {
			"no workstream": 0.71,
			"AbysmalBiscuit/workcell#654": 0.42,
			"AbysmalBiscuit/workcell#69": 0.3,
			"AbysmalBiscuit/workcell#80": 0.4,
			"AbysmalBiscuit/workcell#697": 0.46,
			"AbysmalBiscuit/workcell#150": 0.79,
			"AbysmalBiscuit/workcell#237": 0.63,
		};
		const { input, layout } = await workcellLayout("left-to-right");
		const shares = Object.fromEntries(
			Object.keys(recorded).map((band) => {
				const frame = layout.groups.get(groupId(band));
				const cards = input.cards.filter(
					(item) => item.group === groupId(band),
				).length;
				const share =
					frame === undefined
						? 0
						: fillShare(cards, {
								width: frame.width - groupPad * 2,
								height: frame.height - groupHead - groupPad,
							});
				return [band, Math.round(share * 100) / 100];
			}),
		);
		const sparse = Object.entries(recorded).flatMap(([band, share]) =>
			(shares[band] ?? 0) < share
				? [`${band}: ${shares[band]} < ${share}`]
				: [],
		);
		expect(sparse).toEqual([]);
	});

	test("sibling group frames do not overlap", async () => {
		for (const direction of ["left-to-right", "top-to-bottom"] as const) {
			const { layout } = await workcellLayout(direction);
			const frames = [...layout.groups];
			expect(frames.length).toBeGreaterThan(1);
			const overlapping = frames.flatMap(([id, frame], index) =>
				frames
					.slice(index + 1)
					.filter(([, other]) => overlap(frame, other))
					.map(([other]) => `${id} / ${other}`),
			);
			expect({ direction, overlapping }).toEqual({
				direction,
				overlapping: [],
			});
		}
	});

	test("each sub-ticket sits inside the frame of each parent ticket above it", async () => {
		const report = await hierarchyReport("");
		for (const groupBy of ["workstream", "theme"] as const) {
			for (const direction of ["left-to-right", "top-to-bottom"] as const) {
				const input = layoutInput(report, groupBy, []);
				const layout = await layoutGraph(
					elk,
					input,
					direction,
					card,
					() => 0,
					() => 0,
				);
				expect({
					groupBy,
					direction,
					frames: input.frames.map((frame) => frame.head).sort(),
					stray: strayCards(layout, Object.keys(chains)),
				}).toEqual({
					groupBy,
					direction,
					frames: ["WID-1", "WID-10", "WID-2", "WID-3", "WID-7"]
						.map(cardOf)
						.sort(),
					stray: [],
				});
			}
		}
	});

	test("a filtered-out parent ticket still frames its shown sub-ticket", async () => {
		const report = await hierarchyReport("borders");
		const input = layoutInput(report, "workstream", []);
		const layout = await layoutGraph(
			elk,
			input,
			"left-to-right",
			card,
			() => 0,
			() => 0,
		);
		expect({
			cards: input.cards.map((item) => item.id).sort(),
			stray: strayCards(layout, ["WID-5"]),
		}).toEqual({
			cards: ["WID-1", "WID-2", "WID-3", "WID-5"].map(cardOf).sort(),
			stray: [],
		});
	});

	test("sibling parent ticket frames do not overlap", async () => {
		const report = await hierarchyReport("");
		for (const direction of ["left-to-right", "top-to-bottom"] as const) {
			const input = layoutInput(report, "workstream", []);
			const layout = await layoutGraph(
				elk,
				input,
				direction,
				card,
				() => 0,
				() => 0,
			);
			const boxes = [...layout.cards].map(
				([id, place]) => [id, { ...place, ...card }] as const,
			);
			const cardOverlaps = boxes.flatMap(([id, box], index) =>
				boxes
					.slice(index + 1)
					.filter(([, other]) => overlap(box, other))
					.map(([other]) => `${id} / ${other}`),
			);
			expect({
				direction,
				overlapping: frameOverlaps(input, layout),
				cardOverlaps,
			}).toEqual({
				direction,
				overlapping: [],
				cardOverlaps: [],
			});
		}
	});

	test("a parent ticket heads a frame in each workstream that holds its sub-tickets", async () => {
		const report = await hierarchyReport("", milestones);
		const input = layoutInput(report, "workstream", []);
		const ticketOf = new Map(input.cards.map((item) => [item.id, item]));
		const frameOf = new Map(input.frames.map((frame) => [frame.id, frame]));
		const shown = (id: string) => {
			const item = ticketOf.get(id);
			return `${item?.ticket ?? id} in ${item?.group ?? "no group"}`;
		};
		const holders = (frame: string | null): string[] => {
			const found = frame === null ? undefined : frameOf.get(frame);
			return found === undefined ? [] : [found.id, ...holders(found.parent)];
		};
		for (const direction of ["left-to-right", "top-to-bottom"] as const) {
			const layout = await layoutGraph(
				elk,
				input,
				direction,
				card,
				() => 0,
				() => 0,
			);
			const stray = input.cards.flatMap((item) => {
				const place = layout.cards.get(item.id);
				const box = place === undefined ? undefined : { ...place, ...card };
				const group = layout.groups.get(item.group ?? "");
				return [
					...holders(item.frame).map(
						(frame) => [frame, layout.frames.get(frame)] as const,
					),
					[item.group, group] as const,
				].flatMap(([holder, rect]) =>
					box !== undefined && rect !== undefined && inside(box, rect)
						? []
						: [`${shown(item.id)} / ${holder}`],
				);
			});
			expect({
				direction,
				frames: input.frames
					.map((frame) => `${shown(frame.head)} / ${frame.group}`)
					.sort(),
				chains: input.cards
					.map((item) =>
						[
							shown(item.id),
							...holders(item.frame).map((frame) =>
								shown(frameOf.get(frame)?.head ?? frame),
							),
						].join(" < "),
					)
					.sort(),
				stray,
			}).toEqual({
				direction,
				frames: [
					`${cardOf("WID-1")} in ${groupId("Beta")} / ${groupId("Beta")}`,
					`${cardOf("WID-1")} in ${groupId("Gamma")} / ${groupId("Gamma")}`,
					`${cardOf("WID-3")} in ${groupId("Gamma")} / ${groupId("Gamma")}`,
				].sort(),
				chains: [
					`${cardOf("WID-1")} in ${groupId("Beta")}`,
					`${cardOf("WID-1")} in ${groupId("Gamma")}`,
					`${cardOf("WID-2")} in ${groupId("Beta")} < ${cardOf("WID-1")} in ${groupId("Beta")}`,
					`${cardOf("WID-3")} in ${groupId("Gamma")} < ${cardOf("WID-1")} in ${groupId("Gamma")}`,
					`${cardOf("WID-4")} in ${groupId("Gamma")} < ${cardOf("WID-3")} in ${groupId("Gamma")} < ${cardOf("WID-1")} in ${groupId("Gamma")}`,
				].sort(),
				stray: [],
			});
		}
	});

	test("a parent ticket whose sub-tickets are all hidden shows as a plain card", async () => {
		const report = await hierarchyReport("ship the widget");
		expect(layoutInput(report, "workstream", [])).toMatchObject({
			cards: [{ id: cardOf("WID-1"), frame: null }],
			frames: [],
		});
	});

	test("a flat grouping frames no parent ticket", async () => {
		const report = await hierarchyReport("");
		expect(
			(["assignee", "none"] as const).map((groupBy) => ({
				groupBy,
				frames: layoutInput(report, groupBy, []).frames,
			})),
		).toEqual([
			{ groupBy: "assignee", frames: [] },
			{ groupBy: "none", frames: [] },
		]);
	});
});
