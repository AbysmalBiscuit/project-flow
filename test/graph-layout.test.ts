import { afterAll, describe, expect, test } from "bun:test";

import ELK from "elkjs/lib/elk-api.js";

import { focusChain } from "../src/focus-chain.ts";
import { graphTickets, projectNodeId } from "../src/graph-flow.ts";
import { grownLayout } from "../src/graph-grow.ts";
import {
	focusLinks,
	focusSeeds,
	type GraphLayout,
	groupHead,
	groupId,
	groupPad,
	layoutGraph,
	type LayoutInput,
	layoutInput,
} from "../src/graph-layout.ts";
import {
	card,
	cardOf,
	cardOverlaps,
	chains,
	fillShare,
	frameOverlaps,
	hierarchyReport,
	inside,
	linearTicket,
	milestones,
	overlap,
	strayCards,
	strayFromHolders,
	tallCards,
	workcell,
} from "./graph-layout/_support.ts";

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

const platformEpic = {
	identifier: "PLT-3",
	title: "Platform epic",
	url: "https://linear.app/acme/issue/PLT-3/platform-epic",
	state: { type: "started" },
	project: { name: "Platform" },
};

const loneEpic = {
	identifier: "OPS-9",
	title: "Ops cleanup",
	url: "https://linear.app/acme/issue/OPS-9/ops-cleanup",
	state: { type: "completed" },
	project: null,
};

// WID-30 to WID-32 sit under PLT-3 from another project, across two
// milestones, and WID-33 sits under OPS-9, which no project holds.
const outsideParents = [
	{
		...linearTicket("WID-30", "Hook the platform", "unstarted", null),
		parent: platformEpic,
	},
	{
		...linearTicket("WID-31", "Gate the platform", "unstarted", null),
		parent: platformEpic,
	},
	{
		...linearTicket(
			"WID-32",
			"Ship the platform",
			"unstarted",
			null,
			[],
			"Gamma",
		),
		parent: platformEpic,
	},
	{
		...linearTicket("WID-33", "Clean the logs", "unstarted", null),
		parent: loneEpic,
	},
	linearTicket("WID-34", "Write the runbook", "unstarted", null),
];

/**
 * The cards of each layer of each holder, in their order across the layer.
 * A layer is the cards of one holder that share a place along the arrows.
 */
function layerOrders(
	input: LayoutInput,
	layout: GraphLayout,
	direction: "left-to-right" | "top-to-bottom",
): Record<string, string[]> {
	const horizontal = direction === "left-to-right";
	const at = (id: string) => layout.cards.get(id) ?? { x: 0, y: 0 };
	const layers = Map.groupBy(input.cards, (item) => {
		const place = at(item.id);
		const holder = item.frame ?? item.group ?? "root";
		return `${holder} @ ${horizontal ? place.x : place.y}`;
	});
	return Object.fromEntries(
		[...layers].map(([layer, items]) => [
			layer,
			items
				.map((item) => item.id)
				.sort((one, other) =>
					horizontal ? at(one).y - at(other).y : at(one).x - at(other).x,
				),
		]),
	);
}

describe("project graph layout", () => {
	test("each workcell workstream frame fills at least the share the elkjs spike recorded", async () => {
		// The elkjs spike in issue 349 recorded these shares for ELK `layered`.
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

	test("each frame holds its cards at their measured sizes", async () => {
		const reports = { hierarchy: await hierarchyReport(""), workcell };
		for (const [name, report] of Object.entries(reports)) {
			for (const groupBy of ["workstream", "theme"] as const) {
				for (const direction of ["left-to-right", "top-to-bottom"] as const) {
					const input = layoutInput(report, groupBy, []);
					const sizes = tallCards(input);
					const layout = await layoutGraph(
						elk,
						input,
						direction,
						card,
						() => 0,
						() => 0,
						sizes,
					);
					expect({
						name,
						groupBy,
						direction,
						stray: strayFromHolders(input, layout, sizes),
						cardOverlaps: cardOverlaps(layout, sizes),
					}).toEqual({
						name,
						groupBy,
						direction,
						stray: [],
						cardOverlaps: [],
					});
				}
			}
		}
	});

	test("cards do not overlap when the drawn card is taller than the flow gap", async () => {
		const tall = { width: card.width, height: card.height * 2.5 };
		for (const direction of ["left-to-right", "top-to-bottom"] as const) {
			const input = layoutInput(workcell, "workstream", []);
			const layout = await layoutGraph(
				elk,
				input,
				direction,
				tall,
				() => 0,
				() => 0,
			);
			expect({
				direction,
				cardOverlaps: cardOverlaps(
					layout,
					new Map(input.cards.map((item) => [item.id, tall])),
				),
			}).toEqual({ direction, cardOverlaps: [] });
		}
	});

	test("cards at the board card width grow taller with their title and chips and do not overlap", async () => {
		const boardCard = { width: 240, height: 64 };
		const rows = new Map(
			workcell.graphTickets.map((ticket) => {
				const chips =
					(ticket.chips?.length ?? 0) +
					(ticket.blockers?.length ?? 0) +
					(ticket.outsideBlockers?.length ?? 0);
				return [
					projectNodeId(workcell.name, ticket.key ?? ""),
					Math.ceil(ticket.title.length / 30) + Math.ceil(chips / 2),
				] as const;
			}),
		);
		for (const direction of ["left-to-right", "top-to-bottom"] as const) {
			const input = layoutInput(workcell, "workstream", []);
			const sizes = new Map(
				input.cards.map((item) => [
					item.id,
					{
						width: boardCard.width,
						height: boardCard.height + 20 * (rows.get(item.id) ?? 1),
					},
				]),
			);
			expect(
				new Set([...sizes.values()].map((size) => size.height)).size,
			).toBeGreaterThan(3);
			const layout = await layoutGraph(
				elk,
				input,
				direction,
				boardCard,
				() => 0,
				() => 0,
				sizes,
			);
			expect({
				direction,
				stray: strayFromHolders(input, layout, sizes),
				cardOverlaps: cardOverlaps(layout, sizes),
			}).toEqual({ direction, stray: [], cardOverlaps: [] });
		}
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

	test("an outside parent ticket heads a frame in each workstream that holds its sub-tickets", async () => {
		const report = await hierarchyReport("", outsideParents);
		const input = layoutInput(report, "workstream", []);
		const ticketOf = new Map(input.cards.map((item) => [item.id, item]));
		const frameOf = new Map(input.frames.map((frame) => [frame.id, frame]));
		const shown = (id: string) => {
			const item = ticketOf.get(id);
			return `${item?.ticket ?? id} in ${item?.group ?? "no group"}`;
		};
		const platform = projectNodeId("Platform", "PLT-3");
		const ops = projectNodeId("", "OPS-9");
		const layout = await layoutGraph(
			elk,
			input,
			"left-to-right",
			card,
			() => 0,
			() => 0,
		);
		const stray = input.cards.flatMap((item) => {
			const frame =
				item.frame === null ? undefined : layout.frames.get(item.frame);
			const place = layout.cards.get(item.id);
			return frame === undefined ||
				place === undefined ||
				inside({ ...place, ...card }, frame)
				? []
				: [shown(item.id)];
		});
		expect({
			cards: input.cards
				.map((item) =>
					[
						shown(item.id),
						...(item.frame === null
							? []
							: [shown(frameOf.get(item.frame)?.head ?? "")]),
					].join(" < "),
				)
				.sort(),
			titles: input.frames.map((frame) => frame.title).sort(),
			stray,
		}).toEqual({
			cards: [
				`${platform} in ${groupId("Beta")}`,
				`${platform} in ${groupId("Gamma")}`,
				`${ops} in ${groupId("Beta")}`,
				`${cardOf("WID-30")} in ${groupId("Beta")} < ${platform} in ${groupId("Beta")}`,
				`${cardOf("WID-31")} in ${groupId("Beta")} < ${platform} in ${groupId("Beta")}`,
				`${cardOf("WID-32")} in ${groupId("Gamma")} < ${platform} in ${groupId("Gamma")}`,
				`${cardOf("WID-33")} in ${groupId("Beta")} < ${ops} in ${groupId("Beta")}`,
				`${cardOf("WID-34")} in ${groupId("Beta")}`,
			].sort(),
			titles: ["Ops cleanup", "Platform epic", "Platform epic"],
			stray: [],
		});
	});

	test("an outside parent ticket that its sub-ticket blocks heads one frame with its state", async () => {
		const reviewEpic = {
			...platformEpic,
			state: { type: "started", name: "In Review" },
		};
		const report = await hierarchyReport("", [
			{
				...linearTicket("WID-40", "Wire the platform", "unstarted", null),
				parent: reviewEpic,
				inverseRelations: {
					nodes: [
						{
							type: "blockedBy",
							issue: {
								identifier: "PLT-3",
								title: "Platform epic",
								state: { type: "started" },
								project: { name: "Platform", slugId: "platform-slug" },
							},
						},
					],
				},
			},
		]);
		const input = layoutInput(report, "workstream", []);
		const sub = input.cards.find((item) => item.id === cardOf("WID-40"));
		const head = input.frames.find((frame) => frame.id === sub?.frame)?.head;
		const headTicket = input.cards.find((item) => item.id === head)?.ticket;
		expect({
			heads: graphTickets(report, true).flatMap((ticket) =>
				projectNodeId(ticket.project, ticket.key) === headTicket
					? [{ key: ticket.key, title: ticket.title, state: ticket.state }]
					: [],
			),
			tickets: [...new Set(input.cards.map((item) => item.ticket))].sort(),
		}).toEqual({
			heads: [{ key: "PLT-3", title: "Platform epic", state: "inReview" }],
			tickets: [projectNodeId("Platform", "PLT-3"), cardOf("WID-40")].sort(),
		});
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

	test("a card that grows keeps the order of every card in each layer", async () => {
		const chipRow = 28;
		for (const direction of ["left-to-right", "top-to-bottom"] as const) {
			const { input, layout } = await workcellLayout(direction);
			const slots = new Map(input.cards.map((item) => [item.id, card]));
			const before = layerOrders(input, layout, direction);
			const moved = input.cards.flatMap((item) => {
				const sizes = new Map(slots).set(item.id, {
					...card,
					height: card.height + chipRow,
				});
				const grown = grownLayout(input, layout, slots, sizes, card);
				const after = layerOrders(input, grown.layout, direction);
				const problems = [
					...Object.keys(before).flatMap((layer) =>
						Object.values(after).some(
							(items) => items.join() === before[layer]?.join(),
						)
							? []
							: [`${layer} changed`],
					),
					...cardOverlaps(grown.layout, sizes),
					...strayFromHolders(input, grown.layout, sizes),
				];
				return problems.length === 0 ? [] : [{ grown: item.id, problems }];
			});
			expect({ direction, moved }).toEqual({ direction, moved: [] });
		}
	});
});
