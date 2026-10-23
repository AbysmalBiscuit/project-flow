import type { NodeBound } from "./graph-routes.ts";

function borderToward(
	from: NodeBound,
	to: NodeBound,
): { x: number; y: number } {
	const x = (from.left + from.right) / 2;
	const y = (from.top + from.bottom) / 2;
	const dx = (to.left + to.right) / 2 - x;
	const dy = (to.top + to.bottom) / 2 - y;
	const reach = Math.min(
		dx === 0
			? Number.POSITIVE_INFINITY
			: (from.right - from.left) / 2 / Math.abs(dx),
		dy === 0
			? Number.POSITIVE_INFINITY
			: (from.bottom - from.top) / 2 / Math.abs(dy),
	);
	return Number.isFinite(reach)
		? { x: x + dx * reach, y: y + dy * reach }
		: { x, y };
}

/** The straight path from the border of `source` to the border of `target`, on the line between their centres. */
export function straightPath(source: NodeBound, target: NodeBound): string {
	const start = borderToward(source, target);
	const end = borderToward(target, source);
	return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}
