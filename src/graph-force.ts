import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type SimulationNodeDatum,
} from "d3-force";
import {
	cardSizes,
	framePad,
	type GraphLayout,
	groupHead,
	groupPad,
	type LayoutInput,
	type Rect,
} from "./graph-layout.ts";
import type { NodeSize } from "./graph-sizes.ts";

/** The space that the Force layout keeps between two sibling cards or frames. */
const siblingGap = framePad;

type CardDatum = SimulationNodeDatum & { id: string };

/**
 * A group or a parent ticket frame. Its `cards` sit in it loose, and the
 * `holders` are the frames inside it. `top` is the height above its cards.
 */
type Holder = {
	id: string;
	cards: CardDatum[];
	holders: Holder[];
	top: number;
	side: number;
	minWidth: number;
};

/** A card or a frame that the overlap pass moves as one piece. */
type Item = { box: () => Rect; move: (dx: number, dy: number) => void };

function cardBox(datum: CardDatum, card: NodeSize): Rect {
	return {
		x: (datum.x ?? 0) - card.width / 2,
		y: (datum.y ?? 0) - card.height / 2,
		...card,
	};
}

type SizeOf = (id: string) => NodeSize;

function holderBox(holder: Holder, sizeOf: SizeOf): Rect {
	const inner = [
		...holder.cards.map((datum) => cardBox(datum, sizeOf(datum.id))),
		...holder.holders.map((child) => holderBox(child, sizeOf)),
	];
	const left = Math.min(...inner.map((box) => box.x));
	const top = Math.min(...inner.map((box) => box.y));
	const right = Math.max(...inner.map((box) => box.x + box.width));
	const bottom = Math.max(...inner.map((box) => box.y + box.height));
	return {
		x: left - holder.side,
		y: top - holder.top,
		width: Math.max(right - left + holder.side * 2, holder.minWidth),
		height: bottom - top + holder.top + holder.side,
	};
}

function membersOf(holder: Holder): CardDatum[] {
	return [...holder.cards, ...holder.holders.flatMap(membersOf)];
}

function moveAll(members: readonly CardDatum[], dx: number, dy: number): void {
	for (const node of members) {
		node.x = (node.x ?? 0) + dx;
		node.y = (node.y ?? 0) + dy;
	}
}

/** The sibling items of each holder: its frames, and each loose card on its own. */
function siblingLevels(
	root: Holder,
	holders: readonly Holder[],
	sizeOf: SizeOf,
): Item[][] {
	return [root, ...holders].map((holder) => [
		...holder.cards.map((datum) => ({
			box: () => cardBox(datum, sizeOf(datum.id)),
			move: (dx: number, dy: number) => moveAll([datum], dx, dy),
		})),
		...holder.holders.map((child) => {
			const members = membersOf(child);
			return {
				box: () => holderBox(child, sizeOf),
				move: (dx: number, dy: number) => moveAll(members, dx, dy),
			};
		}),
	]);
}

/**
 * Moves each two overlapping sibling items apart along the shorter overlap,
 * by `share` of that overlap. Returns true when any item moved.
 */
function separate(levels: readonly Item[][], share: number): boolean {
	let moved = false;
	for (const items of levels) {
		const boxes = items.map((item) => item.box());
		for (const [index, one] of items.entries()) {
			for (const [offset, two] of items.slice(index + 1).entries()) {
				const a = boxes[index];
				const b = boxes[index + 1 + offset];
				if (a === undefined || b === undefined) {
					continue;
				}
				const dx =
					Math.min(a.x + a.width, b.x + b.width) -
					Math.max(a.x, b.x) +
					siblingGap;
				const dy =
					Math.min(a.y + a.height, b.y + b.height) -
					Math.max(a.y, b.y) +
					siblingGap;
				if (dx <= 0 || dy <= 0) {
					continue;
				}
				moved = true;
				const alongX = dx < dy;
				const sign = alongX
					? Math.sign(a.x * 2 + a.width - b.x * 2 - b.width) || 1
					: Math.sign(a.y * 2 + a.height - b.y * 2 - b.height) || 1;
				const push = ((alongX ? dx : dy) / 2 + 1) * share;
				for (const [item, box, direction] of [
					[one, a, sign],
					[two, b, -sign],
				] as const) {
					const dxBy = alongX ? push * direction : 0;
					const dyBy = alongX ? 0 : push * direction;
					box.x += dxBy;
					box.y += dyBy;
					item.move(dxBy, dyBy);
				}
			}
		}
	}
	return moved;
}

/** Pulls the members of each frame toward their centre and pushes siblings apart. */
function frameForce(frames: readonly CardDatum[][], levels: readonly Item[][]) {
	return (alpha: number) => {
		for (const members of frames) {
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

function settle(levels: readonly Item[][]): void {
	for (let pass = 0; pass < 2000 && separate(levels, 1); pass += 1) {}
}

/**
 * Lays out the project graph with d3-force, and removes the overlaps of
 * sibling cards and frames at the end. `titleGrowth` and `sizes` work as in
 * `layoutGraph`. `growGroups` adds the height of wrapped group labels.
 */
export function forceLayout(
	input: LayoutInput,
	card: NodeSize,
	titleGrowth: (title: string) => number,
	sizes: ReadonlyMap<string, NodeSize> = new Map(),
): GraphLayout {
	const { sizeOf, headOf } = cardSizes(card, sizes, titleGrowth);
	const root: Holder = {
		id: "root",
		cards: [],
		holders: [],
		top: 0,
		side: 0,
		minWidth: 0,
	};
	const holders = new Map<string, Holder>();
	for (const group of input.groups) {
		holders.set(group.id, {
			id: group.id,
			cards: [],
			holders: [],
			top: group.framed ? groupHead : 0,
			side: group.framed ? groupPad : 0,
			minWidth: 0,
		});
	}
	for (const frame of input.frames) {
		const head = headOf(frame);
		holders.set(frame.id, {
			id: frame.id,
			cards: [],
			holders: [],
			top: framePad * 2 + head.height,
			side: framePad,
			minWidth: head.width + framePad * 2,
		});
	}
	const holderOf = (id: string | null): Holder => holders.get(id ?? "") ?? root;
	for (const group of input.groups) {
		root.holders.push(holderOf(group.id));
	}
	for (const frame of input.frames) {
		holderOf(frame.parent ?? frame.group).holders.push(holderOf(frame.id));
	}
	const heads = new Map(input.frames.map((frame) => [frame.head, frame.id]));
	const nodes: CardDatum[] = [];
	for (const item of input.cards) {
		if (!heads.has(item.id)) {
			const datum = { id: item.id };
			nodes.push(datum);
			holderOf(item.frame ?? item.group).cards.push(datum);
		}
	}
	const columns = Math.ceil(Math.sqrt(nodes.length));
	for (const [index, datum] of membersOf(root).entries()) {
		datum.x = (index % columns) * (card.width + siblingGap * 2);
		datum.y = Math.floor(index / columns) * (card.height + siblingGap * 2);
	}
	const levels = siblingLevels(root, [...holders.values()], sizeOf);
	const ids = new Set(nodes.map((node) => node.id));
	const links = input.edges
		.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
		.map((edge) => ({ source: edge.from, target: edge.to }));
	const reach = Math.hypot(card.width, card.height);
	forceSimulation(nodes)
		.force(
			"link",
			forceLink<CardDatum, { source: string; target: string }>(links)
				.id((node) => node.id)
				.distance(reach)
				.strength(0.3),
		)
		.force(
			"charge",
			forceManyBody<CardDatum>()
				.strength(-120)
				.distanceMax(reach * 3),
		)
		.force("collide", forceCollide<CardDatum>(reach / 2))
		.force("x", forceX<CardDatum>(0).strength(0.02))
		.force("y", forceY<CardDatum>(0).strength(0.02))
		.force("frames", frameForce([...holders.values()].map(membersOf), levels))
		.stop()
		.tick(300);
	settle(levels);
	const layout: GraphLayout = {
		cards: new Map(),
		groups: new Map(),
		frames: new Map(),
	};
	for (const datum of nodes) {
		const { x, y } = cardBox(datum, sizeOf(datum.id));
		layout.cards.set(datum.id, { x, y });
	}
	for (const frame of input.frames) {
		const box = holderBox(holderOf(frame.id), sizeOf);
		layout.frames.set(frame.id, box);
		layout.cards.set(frame.head, { x: box.x + framePad, y: box.y + framePad });
	}
	for (const group of input.groups) {
		if (group.framed) {
			layout.groups.set(group.id, holderBox(holderOf(group.id), sizeOf));
		}
	}
	return layout;
}

function bounds(boxes: readonly Rect[]): Rect {
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	return {
		x: left,
		y: top,
		width: Math.max(...boxes.map((box) => box.x + box.width)) - left,
		height: Math.max(...boxes.map((box) => box.y + box.height)) - top,
	};
}

/**
 * Grows each group frame of a Force layout by the extra height of its wrapped
 * label, then moves the groups apart. The page runs it after the worker,
 * because `headGrowth` measures the label in the page.
 */
export function growGroups(
	input: LayoutInput,
	layout: GraphLayout,
	card: NodeSize,
	headGrowth: (label: string, width: number) => number,
	sizes: ReadonlyMap<string, NodeSize> = new Map(),
): GraphLayout {
	const items = input.groups.flatMap((group): Item[] => {
		const cards = input.cards.filter((item) => item.group === group.id);
		const frames = input.frames.filter((frame) => frame.group === group.id);
		const framed = layout.groups.get(group.id);
		const placed = [
			...cards.flatMap((item) => {
				const place = layout.cards.get(item.id);
				return place === undefined
					? []
					: [{ ...place, ...(sizes.get(item.id) ?? card) }];
			}),
			...frames.flatMap((frame) => {
				const box = layout.frames.get(frame.id);
				return box === undefined ? [] : [box];
			}),
		];
		if (placed.length === 0) {
			return [];
		}
		if (framed !== undefined) {
			const growth = headGrowth(group.label, framed.width);
			framed.y -= growth;
			framed.height += growth;
		}
		const box = framed ?? bounds(placed);
		return [
			{
				box: () => ({ ...box }),
				move: (dx, dy) => {
					for (const rect of [
						box,
						...frames.flatMap((frame) => {
							const found = layout.frames.get(frame.id);
							return found === undefined ? [] : [found];
						}),
					]) {
						rect.x += dx;
						rect.y += dy;
					}
					for (const item of cards) {
						const place = layout.cards.get(item.id);
						if (place !== undefined) {
							layout.cards.set(item.id, { x: place.x + dx, y: place.y + dy });
						}
					}
				},
			},
		];
	});
	settle([items]);
	return layout;
}
