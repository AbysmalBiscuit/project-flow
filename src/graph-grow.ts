import type { GraphLayout, LayoutInput, Point, Rect } from "./graph-layout.ts";
import type { NodeSize } from "./graph-sizes.ts";

const rootId = "root";

/** The holder of each card, frame and group. A frame holds its head card. */
function holders(input: LayoutInput): Map<string, string> {
	const headed = new Map(input.frames.map((frame) => [frame.head, frame.id]));
	const holderOf = new Map<string, string>();
	for (const group of input.groups) {
		holderOf.set(group.id, rootId);
	}
	for (const frame of input.frames) {
		holderOf.set(frame.id, frame.parent ?? frame.group ?? rootId);
	}
	for (const card of input.cards) {
		holderOf.set(
			card.id,
			headed.get(card.id) ?? card.frame ?? card.group ?? rootId,
		);
	}
	return holderOf;
}

/**
 * Pushes the cards of a laid graph apart, with no new layout, so that each
 * card in `sizes` that outgrew its slot gets its new height. Each box below
 * the old bottom edge moves down, so no card changes its layer or order.
 * A card that shrinks keeps its slot. `card` is the slot of an unmeasured card.
 */
export function grownLayout(
	input: LayoutInput,
	layout: GraphLayout,
	slots: ReadonlyMap<string, NodeSize>,
	sizes: ReadonlyMap<string, NodeSize>,
	card: NodeSize,
): { layout: GraphLayout; slots: ReadonlyMap<string, NodeSize> } {
	const growth = input.cards.flatMap(({ id }) => {
		const slot = slots.get(id);
		const size = sizes.get(id);
		return slot !== undefined && size !== undefined && size.height > slot.height
			? [{ id, slot, height: size.height }]
			: [];
	});
	if (growth.length === 0) {
		return { layout, slots };
	}
	const holderOf = holders(input);
	const members = Map.groupBy(holderOf.keys(), (id) => holderOf.get(id));
	const cards = new Map(layout.cards);
	const frames = new Map(layout.frames);
	const groups = new Map(layout.groups);
	const grownSlots = new Map(slots);
	const box = (id: string): Rect | undefined => {
		const point = cards.get(id);
		if (point !== undefined) {
			return { ...point, ...(grownSlots.get(id) ?? card) };
		}
		const rect = frames.get(id) ?? groups.get(id);
		if (rect !== undefined) {
			return rect;
		}
		const inner = (members.get(id) ?? []).flatMap((member) => {
			const found = box(member);
			return found === undefined ? [] : [found];
		});
		if (inner.length === 0) {
			return undefined;
		}
		const top = Math.min(...inner.map((rect) => rect.y));
		const left = Math.min(...inner.map((rect) => rect.x));
		return {
			x: left,
			y: top,
			width: Math.max(...inner.map((rect) => rect.x + rect.width)) - left,
			height: Math.max(...inner.map((rect) => rect.y + rect.height)) - top,
		};
	};
	const down = <At extends Point>(at: At, by: number): At => ({
		...at,
		y: at.y + by,
	});
	const move = (id: string, by: number) => {
		const point = cards.get(id);
		if (point !== undefined) {
			cards.set(id, down(point, by));
		}
		for (const rects of [frames, groups]) {
			const rect = rects.get(id);
			if (rect !== undefined) {
				rects.set(id, down(rect, by));
			}
		}
		for (const member of members.get(id) ?? []) {
			move(member, by);
		}
	};
	const grow = (id: string, bottom: number, by: number) => {
		const holder = holderOf.get(id);
		if (holder === undefined) {
			return;
		}
		const before = holder === rootId ? undefined : box(holder);
		for (const member of members.get(holder) ?? []) {
			const rect = member === id ? undefined : box(member);
			if (rect !== undefined && rect.y >= bottom) {
				move(member, by);
			}
		}
		for (const rects of [frames, groups]) {
			const rect = rects.get(holder);
			if (rect !== undefined) {
				rects.set(holder, { ...rect, height: rect.height + by });
			}
		}
		if (before !== undefined) {
			grow(holder, before.y + before.height, by);
		}
	};
	for (const { id, slot, height } of growth) {
		const top = cards.get(id)?.y;
		if (top === undefined) {
			continue;
		}
		grownSlots.set(id, { ...slot, height });
		grow(id, top + slot.height, height - slot.height);
	}
	return { layout: { cards, frames, groups }, slots: grownSlots };
}
