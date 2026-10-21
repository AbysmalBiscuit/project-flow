import { describe, expect, test } from "bun:test";
import { Position } from "@xyflow/react";
import { labelSpots, measureMarker, routeEdge } from "../src/graph-routes.ts";

describe("graph edges", () => {
	test("four incoming edges keep every arrowhead on the target side", () => {
		const route = {
			sourceX: 0,
			sourceY: 40,
			targetX: 280,
			targetY: 44,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		const ends = [0, 1, 2, 3].map((index) => {
			const drawn = routeEdge(route, 0, 1, [], { x: 0, y: 0 }, index, 4, 88);
			const end = drawn.path.trim().split(" ").slice(-2);
			return Number(end[1]);
		});
		expect(Math.max(...ends) - Math.min(...ends)).toBeLessThanOrEqual(88);
		expect(ends.every((end) => Number.isFinite(end))).toBe(true);
	});

	test("each marker measure probes the host once", () => {
		let probes = 0;
		const root = {
			append() {
				probes += 1;
			},
		};
		const size = measureMarker(
			root as unknown as ParentNode,
			"marker",
			() =>
				({
					style: {},
					className: "",
					getBoundingClientRect: () => ({ width: 22 }),
					remove() {},
				}) as unknown as HTMLElement,
		);
		expect(probes).toBe(1);
		expect(size).toBe(22);
	});

	test("two edge labels do not overlap", () => {
		const route = {
			sourceX: 0,
			sourceY: 40,
			targetX: 280,
			targetY: 44,
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		const spots = labelSpots([
			{
				route,
				lane: 0,
				lanes: 2,
				entry: 0,
				entries: 2,
				nodes: [],
				side: 88,
			},
			{
				route: { ...route, sourceY: 80 },
				lane: 1,
				lanes: 2,
				entry: 1,
				entries: 2,
				nodes: [],
				side: 88,
			},
		]);
		const left = spots[0];
		const right = spots[1];
		if (left === undefined || right === undefined) {
			throw new Error("two labels were expected");
		}
		const overlap =
			Math.abs(left.x - right.x) < 112 && Math.abs(left.y - right.y) < 28;
		expect(overlap).toBe(false);
	});
});
