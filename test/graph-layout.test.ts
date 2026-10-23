import { afterAll, describe, expect, test } from "bun:test";
import ELK from "elkjs/lib/elk-api.js";
import { fillShare } from "../proof/elk-spike/handwritten.ts";
import { focusChain } from "../src/domain.ts";
import {
	focusLinks,
	focusSeeds,
	groupHead,
	groupId,
	groupPad,
	layoutGraph,
	layoutInput,
} from "../src/graph-layout.ts";
import {
	card,
	cardOf,
	cardOverlaps,
	chains,
	frameOverlaps,
	hierarchyReport,
	inside,
	linearTicket,
	milestones,
	overlap,
	strayCards,
	workcell,
} from "./graph-layout-support.ts";

const elk = new ELK({
	workerFactory: () =>
		new Worker(require.resolve("elkjs/lib/elk-worker.min.js")),
});
afterAll(() => elk.terminateWorker());

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
			expect({
				direction,
				overlapping: frameOverlaps(input, layout),
				cardOverlaps: cardOverlaps(layout),
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

	test("a filtered-out parent ticket from another workstream leaves no empty workstream", async () => {
		const report = await hierarchyReport("sort by name", milestones);
		const input = layoutInput(report, "workstream", []);
		expect({
			groups: input.groups.map((group) => group.id),
			cards: input.cards
				.map((item) => `${item.ticket} in ${item.group}`)
				.sort(),
		}).toEqual({
			groups: [groupId("Gamma")],
			cards: ["WID-1", "WID-3", "WID-4"]
				.map((key) => `${cardOf(key)} in ${groupId("Gamma")}`)
				.sort(),
		});
	});

	test("a parent ticket whose sub-tickets are all hidden shows as a plain card", async () => {
		const report = await hierarchyReport("ship the widget");
		expect(layoutInput(report, "workstream", [])).toMatchObject({
			cards: [{ id: cardOf("WID-1"), frame: null }],
			frames: [],
		});
	});

	test("a collapsed frame takes the blocker arrows of its hidden sub-tickets and merges duplicate arrows", async () => {
		// WID-2 and WID-3 under WID-1 both block WID-4, WID-2 blocks its sibling
		// WID-3, and WID-6 blocks WID-5 under WID-1.
		const report = await hierarchyReport("", [
			linearTicket("WID-1", "Ship the widget", "unstarted", null),
			linearTicket("WID-2", "Paint the list", "unstarted", "WID-1"),
			linearTicket("WID-3", "Paint the rows", "unstarted", "WID-1", ["WID-2"]),
			linearTicket("WID-4", "Size the cells", "unstarted", null, [
				"WID-2",
				"WID-3",
			]),
			linearTicket("WID-5", "Sort the list", "unstarted", "WID-1", ["WID-6"]),
			linearTicket("WID-6", "Sort by name", "unstarted", null),
		]);
		const input = layoutInput(
			report,
			"workstream",
			[],
			(key) => key === "WID-1",
		);
		const layout = await layoutGraph(
			elk,
			input,
			"left-to-right",
			card,
			() => 0,
			() => 0,
		);
		expect({
			cards: input.cards
				.map((item) => `${item.id}${item.collapsed ? " collapsed" : ""}`)
				.sort(),
			frames: input.frames,
			edges: input.edges.map((edge) => `${edge.from} -> ${edge.to}`).sort(),
			laid: [...layout.cards.keys()].sort(),
		}).toEqual({
			cards: [
				`${cardOf("WID-1")} collapsed`,
				cardOf("WID-4"),
				cardOf("WID-6"),
			].sort(),
			frames: [],
			edges: [
				`${cardOf("WID-1")} -> ${cardOf("WID-4")}`,
				`${cardOf("WID-6")} -> ${cardOf("WID-1")}`,
			].sort(),
			laid: ["WID-1", "WID-4", "WID-6"].map(cardOf).sort(),
		});
	});

	test("focus on a collapsed frame follows the arrows it takes from its hidden sub-tickets", async () => {
		// WID-6 blocks WID-5 under WID-1, and WID-2 under WID-1 blocks WID-4.
		const report = await hierarchyReport("", [
			linearTicket("WID-1", "Ship the widget", "unstarted", null),
			linearTicket("WID-2", "Paint the list", "unstarted", "WID-1"),
			linearTicket("WID-4", "Size the cells", "unstarted", null, ["WID-2"]),
			linearTicket("WID-5", "Sort the list", "unstarted", "WID-1", ["WID-6"]),
			linearTicket("WID-6", "Sort by name", "unstarted", null),
			linearTicket("WID-7", "Name the widget", "unstarted", null),
		]);
		const links = focusLinks(
			layoutInput(report, "workstream", [], (key) => key === "WID-1"),
		);
		expect({
			fromBlocked: [...focusChain(new Set([cardOf("WID-4")]), links)].sort(),
			fromFrame: [...focusChain(new Set([cardOf("WID-1")]), links)].sort(),
		}).toEqual({
			fromBlocked: ["WID-1", "WID-4", "WID-6"].map(cardOf).sort(),
			fromFrame: ["WID-1", "WID-4", "WID-6"].map(cardOf).sort(),
		});
	});

	test("focus on a hidden sub-ticket moves to the collapsed card that hides it", async () => {
		// WID-3 sits under WID-2 under WID-1, and WID-6 blocks WID-3.
		const report = await hierarchyReport("", [
			linearTicket("WID-1", "Ship the widget", "unstarted", null),
			linearTicket("WID-2", "Paint the list", "unstarted", "WID-1"),
			linearTicket("WID-3", "Sort the list", "unstarted", "WID-2", ["WID-6"]),
			linearTicket("WID-6", "Sort by name", "unstarted", null),
			linearTicket("WID-7", "Name the widget", "unstarted", null),
		]);
		const chainOf = (shut: readonly string[]) => {
			const input = layoutInput(report, "workstream", [], (key) =>
				shut.includes(key),
			);
			const seeds = focusSeeds(input, new Set([cardOf("WID-3")]));
			return [...focusChain(seeds, focusLinks(input))].sort();
		};
		expect({
			inner: chainOf(["WID-2"]),
			both: chainOf(["WID-1", "WID-2"]),
		}).toEqual({
			inner: ["WID-2", "WID-6"].map(cardOf).sort(),
			both: ["WID-1", "WID-6"].map(cardOf).sort(),
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
