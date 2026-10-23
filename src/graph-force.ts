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

type Item = { members: CardDatum[]; box: () => Rect };

function cardBox(datum: CardDatum, card: NodeSize): Rect {
	return {
		x: (datum.x ?? 0) - card.width / 2,
		y: (datum.y ?? 0) - card.height / 2,
		...card,
	};
}

function holderBox(holder: Holder, card: NodeSize): Rect {
	const inner = [
		...holder.cards.map((datum) => cardBox(datum, card)),
		...holder.holders.map((child) => holderBox(child, card)),
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

/** The sibling items of each holder: its frames, and each loose card on its own. */
function siblingLevels(
	root: Holder,
	holders: readonly Holder[],
	card: NodeSize,
): Item[][] {
	return [root, ...holders].map((holder) => [
		...holder.cards.map((datum) => ({
			members: [datum],
			box: () => cardBox(datum, card),
		})),
		...holder.holders.map((child) => ({
			members: membersOf(child),
			box: () => holderBox(child, card),
		})),
	]);
}

/**
 * Moves each two overlapping sibling items apart along the shorter overlap,
 * by `share` of that overlap. Returns true when any item moved.
 */
function separate(levels: readonly Item[][], share: number): boolean {
	let moved = false;
	for (const items of levels) {
		for (const [index, one] of items.entries()) {
			for (const two of items.slice(index + 1)) {
				const a = one.box();
				const b = two.box();
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

/** Pulls the members of each frame toward their centre and pushes siblings apart. */
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

function settle(levels: readonly Item[][]): void {
	for (let pass = 0; pass < 2000 && separate(levels, 1); pass += 1) {}
}

/**
 * Lays out the project graph with d3-force, and removes the overlaps of
 * sibling cards and frames at the end. `headGrowth` and `titleGrowth` work as
 * in `layoutGraph`.
 */
export function forceLayout(
	input: LayoutInput,
	card: NodeSize,
	headGrowth: (label: string, width: number) => number,
	titleGrowth: (title: string) => number,
): GraphLayout {
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
		holders.set(frame.id, {
			id: frame.id,
			cards: [],
			holders: [],
			top: framePad * 2 + card.height + titleGrowth(frame.title),
			side: framePad,
			minWidth: card.width + framePad * 2,
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
	const levels = siblingLevels(root, [...holders.values()], card);
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
		.force("frames", frameForce(levels))
		.stop()
		.tick(300);
	settle(levels);
	const labels = new Map(input.groups.map((group) => [group.id, group]));
	for (const holder of root.holders) {
		const group = labels.get(holder.id);
		if (group?.framed === true) {
			holder.top += headGrowth(group.label, holderBox(holder, card).width);
		}
	}
	settle(levels);
	const layout: GraphLayout = {
		cards: new Map(),
		groups: new Map(),
		frames: new Map(),
	};
	for (const datum of nodes) {
		const { x, y } = cardBox(datum, card);
		layout.cards.set(datum.id, { x, y });
	}
	for (const frame of input.frames) {
		const box = holderBox(holderOf(frame.id), card);
		layout.frames.set(frame.id, box);
		layout.cards.set(frame.head, { x: box.x + framePad, y: box.y + framePad });
	}
	for (const group of input.groups) {
		if (group.framed) {
			layout.groups.set(group.id, holderBox(holderOf(group.id), card));
		}
	}
	return layout;
}
