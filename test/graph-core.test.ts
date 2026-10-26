import { describe, expect, test } from "bun:test";

import { frameTree } from "../src/graph-core.ts";

// The root holds stage `plan` and frame `child`, and the frame holds stage
// `build`. Each stage loops on itself, and `plan` leads to `build`.
function loopTree(selfLoops: boolean) {
	return frameTree({
		holderOf: new Map([
			["plan", "root"],
			["child", "root"],
			["build", "child"],
		]),
		optionsOf: (id) => (id === "child" ? {} : undefined),
		sizeOf: () => ({ width: 168, height: 44 }),
		edges: [
			{ from: "plan", to: "plan" },
			{ from: "build", to: "build" },
			{ from: "plan", to: "build" },
		],
		selfLoops,
	});
}

const ends = (edges: { sources: string[]; targets: string[] }[]) =>
	edges.map((edge) => `${edge.sources.join()}->${edge.targets.join()}`);

describe("graph layout frame tree", () => {
	test("keeps an edge whose two ends are the same node when the switch is on", () => {
		const tree = loopTree(true);
		expect(ends(tree.edgesIn("root"))).toEqual(["plan->plan", "plan->child"]);
		expect(ends(tree.edgesIn("child"))).toEqual(["build->build"]);
		expect(ends(tree.node("child").edges ?? [])).toEqual(["build->build"]);
	});

	test("drops an edge whose two ends are the same node when the switch is off", () => {
		const tree = loopTree(false);
		expect(ends(tree.edgesIn("root"))).toEqual(["plan->child"]);
		expect(ends(tree.edgesIn("child"))).toEqual([]);
	});
});
