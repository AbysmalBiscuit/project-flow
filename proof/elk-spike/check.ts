/** Frame check, arrow readability and SVG pages of a laid-out spike graph. */
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { cell, type Frame, frameCards, type SpikeGraph } from "./graph.ts";

export type Rect = { x: number; y: number; width: number; height: number };

export function rects(laid: ElkNode): Map<string, Rect> {
	const found = new Map<string, Rect>();
	const walk = (node: ElkNode) => {
		for (const child of node.children ?? []) {
			found.set(child.id, {
				x: child.x ?? 0,
				y: child.y ?? 0,
				width: child.width ?? 0,
				height: child.height ?? 0,
			});
			walk(child);
		}
	};
	walk(laid);
	return found;
}

export function frameCount(frames: readonly Frame[]): number {
	return frames.reduce((sum, frame) => sum + 1 + frameCount(frame.frames), 0);
}

export function allFrames(frames: readonly Frame[]): Frame[] {
	return frames.flatMap((frame) => [frame, ...allFrames(frame.frames)]);
}

function segmentHitsRect(
	from: { x: number; y: number },
	to: { x: number; y: number },
	rect: Rect,
): boolean {
	const steps = 24;
	for (let step = 1; step < steps; step += 1) {
		const x = from.x + ((to.x - from.x) * step) / steps;
		const y = from.y + ((to.y - from.y) * step) / steps;
		if (
			x > rect.x &&
			x < rect.x + rect.width &&
			y > rect.y &&
			y < rect.y + rect.height
		) {
			return true;
		}
	}
	return false;
}

function overlaps(left: Rect, right: Rect): boolean {
	return (
		left.x < right.x + right.width &&
		right.x < left.x + left.width &&
		left.y < right.y + right.height &&
		right.y < left.y + left.height
	);
}

export const centre = (rect: Rect) => ({
	x: rect.x + rect.width / 2,
	y: rect.y + rect.height / 2,
});

/** ELK's route of an arrow, or a straight line when the layout gives none. */
function arrowPoints(
	laid: ElkExtendedEdge | undefined,
	from: Rect,
	to: Rect,
	straight: boolean,
): { x: number; y: number }[] {
	const routed = (laid?.sections ?? []).flatMap((section) => [
		section.startPoint,
		...(section.bendPoints ?? []),
		section.endPoint,
	]);
	return straight || routed.length === 0 ? [centre(from), centre(to)] : routed;
}

/** Frame check and arrow readability of one layout. */
export function checkLayout(
	graph: SpikeGraph,
	laid: ElkNode,
	straight: boolean,
) {
	const boxes = rects(laid);
	const cardIds = [...graph.outside, ...graph.groups.flatMap(frameCards)];
	let intruders = 0;
	let siblingOverlaps = 0;
	const frames = allFrames(graph.groups);
	const homeOf = new Map<string, string>();
	for (const frame of frames) {
		const members = new Set(frameCards(frame));
		for (const id of members) {
			homeOf.set(id, frame.id);
		}
		const box = boxes.get(frame.id);
		if (box === undefined) {
			continue;
		}
		for (const id of cardIds) {
			const other = boxes.get(id);
			if (!members.has(id) && other !== undefined && overlaps(box, other)) {
				intruders += 1;
			}
		}
	}
	const siblingsOf = (list: readonly Frame[]) => {
		for (const [index, frame] of list.entries()) {
			for (const other of list.slice(index + 1)) {
				const left = boxes.get(frame.id);
				const right = boxes.get(other.id);
				if (
					left !== undefined &&
					right !== undefined &&
					overlaps(left, right)
				) {
					siblingOverlaps += 1;
				}
			}
			siblingsOf(frame.frames);
		}
	};
	siblingsOf(graph.groups);
	let cardOverlaps = 0;
	for (const [index, id] of cardIds.entries()) {
		for (const other of cardIds.slice(index + 1)) {
			const left = boxes.get(id);
			const right = boxes.get(other);
			if (left !== undefined && right !== undefined && overlaps(left, right)) {
				cardOverlaps += 1;
			}
		}
	}
	const crossing = graph.edges.filter(
		(edge) => homeOf.get(edge.from) !== homeOf.get(edge.to),
	);
	let throughCards = 0;
	let length = 0;
	const laidEdges = new Map((laid.edges ?? []).map((edge) => [edge.id, edge]));
	for (const edge of crossing) {
		const from = boxes.get(edge.from);
		const to = boxes.get(edge.to);
		if (from === undefined || to === undefined) {
			continue;
		}
		const points = arrowPoints(laidEdges.get(edge.id), from, to, straight);
		for (const [index, point] of points.slice(1).entries()) {
			const previous = points[index] ?? point;
			length += Math.hypot(point.x - previous.x, point.y - previous.y);
		}
		const hit = cardIds.some((id) => {
			const box = boxes.get(id);
			if (id === edge.from || id === edge.to || box === undefined) {
				return false;
			}
			return points
				.slice(1)
				.some((point, index) =>
					segmentHitsRect(points[index] ?? point, point, box),
				);
		});
		if (hit) {
			throughCards += 1;
		}
	}
	const width = laid.width ?? 0;
	const height = laid.height ?? 0;
	return {
		intruders,
		siblingOverlaps,
		cardOverlaps,
		crossFrameArrows: crossing.length,
		arrowsThroughCards: throughCards,
		meanArrowCells:
			crossing.length === 0 ? 0 : length / crossing.length / cell.width,
		areaCells: (width * height) / (cell.width * cell.height),
	};
}

export function svgPage(
	title: string,
	frames: { id: string; label: string; box: Rect }[],
	cards: { id: string; label: string; box: Rect; outside: boolean }[],
	arrows: { x: number; y: number }[][],
): string {
	const all = [
		...frames.map((frame) => frame.box),
		...cards.map((item) => item.box),
	];
	const minX = Math.min(...all.map((box) => box.x)) - 20;
	const minY = Math.min(...all.map((box) => box.y)) - 40;
	const maxX = Math.max(...all.map((box) => box.x + box.width)) + 20;
	const maxY = Math.max(...all.map((box) => box.y + box.height)) + 20;
	const escapeText = (text: string) =>
		text
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;");
	const body = [
		...frames.map(
			(frame) =>
				`<g class="frame"><rect x="${frame.box.x}" y="${frame.box.y}" width="${frame.box.width}" height="${frame.box.height}" rx="8"/><text x="${frame.box.x + 8}" y="${frame.box.y + 19}">${escapeText(frame.label)}</text></g>`,
		),
		...arrows.map(
			(points) =>
				`<polyline class="arrow" points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" marker-end="url(#head)"/>`,
		),
		...cards.map(
			(item) =>
				`<g class="card${item.outside ? " outside" : ""}"><rect x="${item.box.x}" y="${item.box.y}" width="${item.box.width}" height="${item.box.height}" rx="6"/><text x="${item.box.x + 10}" y="${item.box.y + 24}">${escapeText(item.label)}</text></g>`,
		),
	].join("\n");
	return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>
body{margin:0;font:13px system-ui,sans-serif;background:#fafafa}
h1{font-size:15px;margin:12px 16px}
.frame rect{fill:rgba(80,110,200,.06);stroke:#7b8fc7;stroke-width:1.5}
.frame text{fill:#3a4a7a;font-weight:600}
.card rect{fill:#fff;stroke:#555;stroke-width:1}
.card.outside rect{stroke-dasharray:5 4;fill:#f3f3f3}
.card text{fill:#222}
.arrow{fill:none;stroke:#c0392b;stroke-width:1.4;opacity:.75}
</style></head><body><h1 id="title">${escapeText(title)}</h1>
<svg xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">
<defs><marker id="head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#c0392b"/></marker></defs>
${body}
</svg></body></html>`;
}

export function shortKey(id: string): string {
	const key = id.split("\n").at(-1) ?? id;
	return key.replace(/^abysmalbiscuit\//, "");
}

export function elkPage(
	title: string,
	graph: SpikeGraph,
	laid: ElkNode,
	straight: boolean,
): string {
	const boxes = rects(laid);
	const frames = allFrames(graph.groups).flatMap((frame) => {
		const box = boxes.get(frame.id);
		return box === undefined
			? []
			: [
					{
						id: frame.id,
						label:
							frame.header === null
								? frame.label
								: `frame ${shortKey(frame.label)}`,
						box,
					},
				];
	});
	const cards = [...graph.outside, ...graph.groups.flatMap(frameCards)].flatMap(
		(id) => {
			const box = boxes.get(id);
			return box === undefined
				? []
				: [
						{
							id,
							label: shortKey(id),
							box,
							outside:
								graph.outside.includes(id) || id.startsWith("outside-parent"),
						},
					];
		},
	);
	const laidEdges = new Map((laid.edges ?? []).map((edge) => [edge.id, edge]));
	const arrows = graph.edges.flatMap((edge) => {
		const from = boxes.get(edge.from);
		const to = boxes.get(edge.to);
		return from === undefined || to === undefined
			? []
			: [arrowPoints(laidEdges.get(edge.id), from, to, straight)];
	});
	return svgPage(title, frames, cards, arrows);
}
