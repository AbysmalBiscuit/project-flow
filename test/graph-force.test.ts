import { describe, expect, test } from "bun:test";

import { forceLayout, growGroups } from "../src/graph-force.ts";
import {
	type GraphLayout,
	type LayoutInput,
	layoutInput,
} from "../src/graph-layout.ts";
import type { NodeSize } from "../src/graph-sizes.ts";
import {
	card,
	cardOverlaps,
	chains,
	frameOverlaps,
	hierarchyReport,
	milestones,
	overlap,
	strayCards,
	strayFromHolders,
	tallCards,
	workcell,
} from "./graph-layout-support.ts";

function forceLaid(
	input: LayoutInput,
	labelGrowth = 0,
	sizes: ReadonlyMap<string, NodeSize> = new Map(),
): GraphLayout {
	return growGroups(
		input,
		forceLayout(input, card, () => 0, sizes),
		card,
		() => labelGrowth,
		sizes,
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

	test("the Force layout holds each card at its measured size", async () => {
		const reports = { hierarchy: await hierarchyReport(""), workcell };
		for (const [name, report] of Object.entries(reports)) {
			for (const groupBy of ["workstream", "theme"] as const) {
				const input = layoutInput(report, groupBy, []);
				const sizes = tallCards(input);
				const layout = forceLaid(input, 0, sizes);
				expect({
					name,
					groupBy,
					stray: strayFromHolders(input, layout, sizes),
					cardOverlaps: cardOverlaps(layout, sizes),
				}).toEqual({ name, groupBy, stray: [], cardOverlaps: [] });
			}
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
