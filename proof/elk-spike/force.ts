/** The d3-force candidate for Force: blocker links, card collision, and frame cohesion. */
import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type SimulationNodeDatum,
} from "d3-force";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import {
	card,
	cell,
	type Frame,
	frameCards,
	framePad,
	type SpikeGraph,
} from "./graph.ts";

type CardDatum = SimulationNodeDatum & { id: string };
type Box = { left: number; top: number; right: number; bottom: number };

function frameBox(frame: Frame, at: Map<string, CardDatum>): Box {
	const boxes: Box[] = [
		...[
			...(frame.header === null ? [] : [frame.header]),
			...frame.cards,
		].flatMap((id) => {
			const datum = at.get(id);
			return datum === undefined
				? []
				: [
						{
							left: (datum.x ?? 0) - card.width / 2,
							top: (datum.y ?? 0) - card.height / 2,
							right: (datum.x ?? 0) + card.width / 2,
							bottom: (datum.y ?? 0) + card.height / 2,
						},
					];
		}),
		...frame.frames.map((child) => frameBox(child, at)),
	];
	return {
		left: Math.min(...boxes.map((box) => box.left)) - framePad.side,
		top: Math.min(...boxes.map((box) => box.top)) - framePad.head,
		right: Math.max(...boxes.map((box) => box.right)) + framePad.side,
		bottom: Math.max(...boxes.map((box) => box.bottom)) + framePad.side,
	};
}

type Item = { members: CardDatum[]; box: () => Box };

/** The sibling items of each container: its frames, and each loose card on its own. */
function siblingLevels(
	graph: SpikeGraph,
	at: Map<string, CardDatum>,
): Item[][] {
	const datums = (ids: readonly string[]) =>
		ids.flatMap((id) => {
			const datum = at.get(id);
			return datum === undefined ? [] : [datum];
		});
	const cardItem = (id: string): Item[] =>
		datums([id]).map((datum) => ({
			members: [datum],
			box: () => ({
				left: (datum.x ?? 0) - card.width / 2,
				top: (datum.y ?? 0) - card.height / 2,
				right: (datum.x ?? 0) + card.width / 2,
				bottom: (datum.y ?? 0) + card.height / 2,
			}),
		}));
	const frameItem = (frame: Frame): Item => ({
		members: datums(frameCards(frame)),
		box: () => frameBox(frame, at),
	});
	const levels: Item[][] = [
		[...graph.outside.flatMap(cardItem), ...graph.groups.map(frameItem)],
	];
	const collect = (frame: Frame) => {
		levels.push([
			...(frame.header === null ? [] : cardItem(frame.header)),
			...frame.cards.flatMap(cardItem),
			...frame.frames.map(frameItem),
		]);
		for (const child of frame.frames) {
			collect(child);
		}
	};
	for (const group of graph.groups) {
		collect(group);
	}
	return levels;
}

/** Moves two overlapping sibling items apart along the shorter overlap; true when any moved. */
function separate(levels: readonly Item[][], share: number): boolean {
	let moved = false;
	for (const items of levels) {
		for (const [index, one] of items.entries()) {
			for (const two of items.slice(index + 1)) {
				const a = one.box();
				const b = two.box();
				const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
				const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
				if (dx <= 0 || dy <= 0) {
					continue;
				}
				moved = true;
				const alongX = dx < dy;
				const sign = alongX
					? Math.sign(a.left + a.right - b.left - b.right) || 1
					: Math.sign(a.top + a.bottom - b.top - b.bottom) || 1;
				const push = ((alongX ? dx : dy) / 2 + 1) * share;
				for (const [members, direction] of [
					[one.members, sign],
					[two.members, -sign],
				] as const) {
					for (const node of members) {
						if (alongX) {
							node.x = (node.x ?? 0) + push * direction;
						} else {
							node.y = (node.y ?? 0) + push * direction;
						}
					}
				}
			}
		}
	}
	return moved;
}

/** Pulls the members of each frame toward the frame centre and separates siblings. */
function frameForce(levels: readonly Item[][]) {
	const frames = levels.flat().filter((item) => item.members.length > 1);
	return (alpha: number) => {
		for (const { members } of frames) {
			const x =
				members.reduce((sum, node) => sum + (node.x ?? 0), 0) / members.length;
			const y =
				members.reduce((sum, node) => sum + (node.y ?? 0), 0) / members.length;
			for (const node of members) {
				node.vx = (node.vx ?? 0) + (x - (node.x ?? 0)) * alpha * 0.2;
				node.vy = (node.vy ?? 0) + (y - (node.y ?? 0)) * alpha * 0.2;
			}
		}
		separate(levels, 0.5);
	};
}

/** Lays out the spike graph with d3-force and returns it in ELK's shape, root coordinates. */
export function forceLayout(graph: SpikeGraph, ticks = 300): ElkNode {
	const ids = [...graph.outside, ...graph.groups.flatMap(frameCards)];
	const nodes: CardDatum[] = ids.map((id, index) => ({
		id,
		x: (index % 20) * cell.width,
		y: Math.floor(index / 20) * cell.height,
	}));
	const at = new Map(nodes.map((node) => [node.id, node]));
	const levels = siblingLevels(graph, at);
	const links = graph.edges
		.filter((edge) => at.has(edge.from) && at.has(edge.to))
		.map((edge) => ({ source: edge.from, target: edge.to }));
	const simulation = forceSimulation(nodes)
		.force(
			"link",
			forceLink<CardDatum, { source: string; target: string }>(links)
				.id((node) => node.id)
				.distance(cell.width)
				.strength(0.3),
		)
		.force(
			"charge",
			forceManyBody<CardDatum>()
				.strength(-120)
				.distanceMax(cell.width * 3),
		)
		.force(
			"collide",
			forceCollide<CardDatum>(Math.hypot(cell.width, cell.height) / 2.6),
		)
		.force("x", forceX<CardDatum>(0).strength(0.02))
		.force("y", forceY<CardDatum>(0).strength(0.02))
		.force("frames", frameForce(levels))
		.stop();
	simulation.tick(ticks);
	for (let pass = 0; pass < 500 && separate(levels, 1); pass += 1) {}
	const cardNode = (id: string): ElkNode[] => {
		const datum = at.get(id);
		return datum === undefined
			? []
			: [
					{
						id,
						x: (datum.x ?? 0) - card.width / 2,
						y: (datum.y ?? 0) - card.height / 2,
						width: card.width,
						height: card.height,
					},
				];
	};
	const frameNode = (frame: Frame): ElkNode => {
		const box = frameBox(frame, at);
		return {
			id: frame.id,
			x: box.left,
			y: box.top,
			width: box.right - box.left,
			height: box.bottom - box.top,
			children: [
				...(frame.header === null ? [] : cardNode(frame.header)),
				...frame.cards.flatMap(cardNode),
				...frame.frames.map(frameNode),
			],
		};
	};
	const children = [
		...graph.outside.flatMap(cardNode),
		...graph.groups.map(frameNode),
	];
	const left = Math.min(...children.map((child) => child.x ?? 0));
	const top = Math.min(...children.map((child) => child.y ?? 0));
	const right = Math.max(
		...children.map((child) => (child.x ?? 0) + (child.width ?? 0)),
	);
	const bottom = Math.max(
		...children.map((child) => (child.y ?? 0) + (child.height ?? 0)),
	);
	return { id: "root", width: right - left, height: bottom - top, children };
}
