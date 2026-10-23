import { describe, expect, test } from "bun:test";
import { forceLayout, growGroups } from "../src/graph-force.ts";
import {
	type GraphLayout,
	type LayoutInput,
	layoutInput,
} from "../src/graph-layout.ts";
import {
	card,
	cardOverlaps,
	chains,
	frameOverlaps,
	hierarchyReport,
	inside,
	milestones,
	overlap,
	strayCards,
	workcell,
} from "./graph-layout-support.ts";

/** Each card that sits outside a parent ticket frame or a group frame that holds it, as `card / holder`. */
function strayFromHolders(input: LayoutInput, layout: GraphLayout): string[] {
	const frameOf = new Map(input.frames.map((frame) => [frame.id, frame]));
	const holders = (frame: string | null): string[] => {
		const found = frame === null ? undefined : frameOf.get(frame);
		return found === undefined ? [] : [found.id, ...holders(found.parent)];
	};
	return input.cards.flatMap((item) => {
		const place = layout.cards.get(item.id);
		if (place === undefined) {
			return [`${item.id} / no card`];
		}
		const box = { ...place, ...card };
		const group = layout.groups.get(item.group ?? "");
		return [
			...holders(item.frame).map(
				(frame) => [frame, layout.frames.get(frame)] as const,
			),
			...(group === undefined ? [] : [[item.group, group] as const]),
		].flatMap(([holder, rect]) =>
			rect !== undefined && inside(box, rect) ? [] : [`${item.id} / ${holder}`],
		);
	});
}

function forceLaid(input: LayoutInput, labelGrowth = 0): GraphLayout {
	return growGroups(
		input,
		forceLayout(input, card, () => 0),
		card,
		() => labelGrowth,
	);
}

describe("project graph Force layout", () => {
	test("the Force layout keeps each sub-ticket inside the frame of its parent ticket", async () => {
		const report = await hierarchyReport("");
		for (const groupBy of ["workstream", "theme"] as const) {
			const input = layoutInput(report, groupBy, []);
			const layout = forceLaid(input);
			expect({
				groupBy,
				stray: strayCards(layout, Object.keys(chains)),
				overlapping: frameOverlaps(input, layout),
				cardOverlaps: cardOverlaps(layout),
			}).toEqual({ groupBy, stray: [], overlapping: [], cardOverlaps: [] });
		}
	});

	test("the Force layout keeps sibling frames apart in each workstream", async () => {
		const report = await hierarchyReport("", milestones);
		for (const input of [
			layoutInput(report, "workstream", []),
			layoutInput(workcell, "workstream", []),
		]) {
			// A wrapped group label makes each group frame taller.
			const layout = forceLaid(input, 40);
			const groups = [...layout.groups];
			expect({
				stray: strayFromHolders(input, layout),
				groups: groups.flatMap(([id, frame], index) =>
					groups
						.slice(index + 1)
						.filter(([, other]) => overlap(frame, other))
						.map(([other]) => `${id} / ${other}`),
				),
				overlapping: frameOverlaps(input, layout),
				cardOverlaps: cardOverlaps(layout),
			}).toEqual({ stray: [], groups: [], overlapping: [], cardOverlaps: [] });
		}
	});
});
