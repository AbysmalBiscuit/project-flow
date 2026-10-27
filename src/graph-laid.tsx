import {
	type RefObject,
	startTransition,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { board } from "./board-styles.ts";
import { elk } from "./graph-core-view.tsx";
import { type FlowGap, flowGap } from "./graph-flow.ts";
import type { ForceRequest } from "./graph-force-worker.ts";
import { growGroups } from "./graph-force.ts";
import { grownLayout } from "./graph-grow.ts";
import { type LaidLink, laneLinks } from "./graph-lanes.ts";
import {
	forceWorkerPath,
	type GraphLayout,
	type LayoutCard,
	layoutGraph,
	type LayoutInput,
	layoutSignature,
	type Point,
} from "./graph-layout.ts";
import { useNodeSizes } from "./graph-node-size.tsx";
import type { NodeSize } from "./graph-sizes.ts";
import { classToken } from "./ui.ts";
import type { GraphDirection, GraphLayoutKind } from "./view-settings.ts";

// `run-graph.tsx` reads the ELK of the page from this module.
export { elk };

function labelHeight(label: string, width: number): number {
	const probe = document.createElement("div");
	probe.className = classToken(board.cluster);
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.style.width = `${width}px`;
	probe.style.height = "auto";
	probe.textContent = label;
	document.body.append(probe);
	const height = probe.getBoundingClientRect().height;
	probe.remove();
	return height;
}

function titleHeight(title: string): number {
	const probe = document.createElement("button");
	probe.className = classToken(board.ticketNode);
	// React Flow sizes each node with border-box.
	probe.style.boxSizing = "border-box";
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	const text = document.createElement("span");
	text.className = classToken(board.title);
	text.textContent = title;
	probe.append(text);
	document.body.append(probe);
	const height = probe.getBoundingClientRect().height;
	probe.remove();
	return height;
}

/** The extra height of a ticket card whose title wraps. */
function titleGrowth(title: string): number {
	return Math.max(0, titleHeight(title) - titleHeight(" "));
}

/** The extra height of a group label that wraps at the frame width. */
function headGrowth(label: string, width: number): number {
	return Math.max(0, labelHeight(label, width) - labelHeight(" ", width));
}

/** Runs the Force layout in a Web Worker of its own. */
async function forceInWorker(
	input: LayoutInput,
	card: NodeSize,
	sizes: ReadonlyMap<string, NodeSize>,
): Promise<GraphLayout> {
	const worker = new Worker(forceWorkerPath, { type: "module" });
	const request: ForceRequest = {
		input,
		card,
		titles: new Map(
			input.frames.map((frame) => [frame.title, titleGrowth(frame.title)]),
		),
		sizes,
	};
	const layout = await new Promise<GraphLayout>((resolve, reject) => {
		worker.onmessage = (event: MessageEvent<GraphLayout>) =>
			resolve(event.data);
		worker.onerror = (event) => reject(new Error(event.message));
		worker.postMessage(request);
	}).finally(() => worker.terminate());
	return growGroups(input, layout, card, headGrowth, sizes);
}

/**
 * One laid graph: the places of its cards and frames, and the lane and label
 * spot of each arrow. It holds no page data: the page draws the contents of
 * each card and arrow from its current data, joined by id.
 */
export type LaidGraph = {
	direction: GraphDirection;
	kind: GraphLayoutKind;
	input: LayoutInput;
	layout: GraphLayout;
	links: LaidLink[];
	/** The size of a card that the page has not measured yet. */
	card: NodeSize;
	/** The slot of each measured card: the size that the layout keeps for it. */
	sizes: ReadonlyMap<string, NodeSize>;
	/** How far the layout moved to keep the anchor card in its place. */
	shift: Point;
	/** Tells whether the cards held their places: an anchor card held, or a card grew. */
	held: boolean;
};

/**
 * How long a layout waits for the page to measure a new card. A card that the
 * page does not draw is never measured, so the layout then runs without it.
 */
const measureWaitMs = 500;

/** A card that keeps its place on the graph when the next layout lands. */
export type Anchor = { card: string; at: Point };

const unshifted: Point = { x: 0, y: 0 };

function moved(point: Point, shift: Point): Point {
	return { x: point.x + shift.x, y: point.y + shift.y };
}

function shifted(layout: GraphLayout, shift: Point): GraphLayout {
	const rects = (boxes: GraphLayout["frames"]) =>
		new Map(
			[...boxes].map(([id, box]) => [id, { ...box, ...moved(box, shift) }]),
		);
	return {
		cards: new Map(
			[...layout.cards].map(([id, point]) => [id, moved(point, shift)]),
		),
		groups: rects(layout.groups),
		frames: rects(layout.frames),
	};
}

/**
 * Moves the new layout so that the anchor card stays where it is. With no
 * anchor card in the layout, the layout keeps the shift of the last layout
 * of the same kind and direction.
 */
function anchored(
	layout: GraphLayout,
	last: Pick<LaidGraph, "kind" | "direction" | "shift"> | null,
	anchor: Anchor | null,
	kind: GraphLayoutKind,
	direction: GraphDirection,
): { layout: GraphLayout; shift: Point; held: boolean } {
	const from = anchor === null ? undefined : layout.cards.get(anchor.card);
	if (anchor !== null && from !== undefined) {
		const shift = { x: anchor.at.x - from.x, y: anchor.at.y - from.y };
		return { layout: shifted(layout, shift), shift, held: true };
	}
	const shift =
		last !== null && last.kind === kind && last.direction === direction
			? last.shift
			: unshifted;
	return { layout: shifted(layout, shift), shift, held: false };
}

/**
 * The value from the last render whose signature was the same, so that a new
 * value with the same signature keeps the last identity.
 */
function useSigned<Value>(value: Value, signature: string): Value {
	const [kept, setKept] = useState({ value, signature });
	if (kept.signature === signature) {
		return kept.value;
	}
	setKept({ value, signature });
	return value;
}

/**
 * Lays out the graph in a Web Worker, and keeps the last layout until the
 * next one lands. `failed` tells whether the latest layout was rejected.
 * A card is laid out at `span` until the page measures it. A card that grows
 * after that pushes the cards below it apart, with no new layout, so that no
 * card changes its layer or its order. Each layout keeps the `anchor`
 * card at the place that the anchor gives. `gap` is the distance from one
 * card to the next in the Layered layout. A new input with the same layout
 * signature keeps the last layout.
 *
 * `unplaced` holds the cards that the laid graph has no place for yet. The
 * page draws them hidden, and after the first layout a layout waits until the
 * page measures them, so that a new card lays out the graph once.
 */
export function useLaidGraph(
	next: LayoutInput,
	direction: GraphDirection,
	kind: GraphLayoutKind,
	span: NodeSize | null,
	anchor: RefObject<Anchor | null>,
	gap: FlowGap = flowGap,
): { laid: LaidGraph | null; failed: boolean; unplaced: LayoutCard[] } {
	const input = useSigned(next, layoutSignature(next));
	const [laid, setLaid] = useState<LaidGraph | null>(null);
	const [failed, setFailed] = useState(false);
	const sizes = useNodeSizes(
		useMemo(() => input.cards.map((card) => card.id), [input]),
	);
	const latestSizes = useRef(sizes);
	latestSizes.current = sizes;
	const measuredIds = input.cards.flatMap((card) =>
		sizes.has(card.id) ? [card.id] : [],
	);
	const measured = useSigned(new Set(measuredIds), measuredIds.join("\n"));
	const laidOnce = useRef(false);
	const unplaced = useMemo(() => {
		if (laid === null) {
			return [];
		}
		const placed = new Set(laid.input.cards.map((card) => card.id));
		return input.cards.filter((card) => !placed.has(card.id));
	}, [laid, input]);
	useEffect(() => {
		if (span === null) {
			return;
		}
		let current = true;
		const lay = () => {
			const sizes = latestSizes.current;
			const laying =
				kind === "force"
					? forceInWorker(input, span, sizes)
					: layoutGraph(
							elk(),
							input,
							direction,
							span,
							headGrowth,
							titleGrowth,
							sizes,
							gap,
						);
			laying.then(
				(layout) => {
					if (!current) {
						return;
					}
					laidOnce.current = true;
					startTransition(() => {
						setLaid((last) => {
							const placed = anchored(
								layout,
								last,
								anchor.current,
								kind,
								direction,
							);
							return {
								direction,
								kind,
								input,
								card: span,
								sizes,
								links: laneLinks(
									input,
									placed.layout,
									direction,
									kind,
									span,
									sizes,
								),
								...placed,
							};
						});
						setFailed(false);
					});
				},
				(error: unknown) => {
					console.error(error);
					if (current) {
						setFailed(true);
					}
				},
			);
		};
		const unmeasured =
			laidOnce.current && input.cards.some((card) => !measured.has(card.id));
		const timer = unmeasured ? setTimeout(lay, measureWaitMs) : null;
		if (timer === null) {
			lay();
		}
		return () => {
			current = false;
			if (timer !== null) {
				clearTimeout(timer);
			}
		};
	}, [direction, kind, input, measured, span, anchor, gap]);
	useEffect(() => {
		startTransition(() => {
			setLaid((last) => {
				if (last === null) {
					return last;
				}
				const grown = grownLayout(
					last.input,
					last.layout,
					last.sizes,
					sizes,
					last.card,
				);
				return grown.layout === last.layout
					? last
					: {
							...last,
							layout: grown.layout,
							sizes: grown.slots,
							links: laneLinks(
								last.input,
								grown.layout,
								last.direction,
								last.kind,
								last.card,
								grown.slots,
							),
							held: true,
						};
			});
		});
	}, [sizes]);
	return { laid, failed, unplaced };
}
