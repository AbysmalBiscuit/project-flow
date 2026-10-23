import {
	type FitViewOptions,
	useReactFlow,
	type Viewport,
} from "@xyflow/react";
import ElkConstructor, { type ELK } from "elkjs/lib/elk-api.js";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { board } from "./board-styles.ts";
import { type FlowGap, flowGap } from "./graph-flow.ts";
import { growGroups } from "./graph-force.ts";
import type { ForceRequest } from "./graph-force-worker.ts";
import {
	elkWorkerPath,
	forceWorkerPath,
	type GraphLayout,
	type LayoutInput,
	layoutGraph,
	type Point,
} from "./graph-layout.ts";
import { useNodeSizes } from "./graph-node-size.tsx";
import { type LaidLink, laneLinks } from "./graph-routes.ts";
import type { NodeSize } from "./graph-sizes.ts";
import { classToken } from "./ui.ts";
import type { GraphDirection, GraphLayoutKind } from "./view-settings.ts";

let pageElk: ELK | null = null;

function elk(): ELK {
	pageElk ??= new ElkConstructor({
		workerFactory: () => new Worker(elkWorkerPath),
	});
	return pageElk;
}

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
 * spot of each arrow. `of` is the page data that the layout came from.
 */
export type LaidGraph<Source> = {
	of: Source;
	direction: GraphDirection;
	kind: GraphLayoutKind;
	input: LayoutInput;
	layout: GraphLayout;
	links: LaidLink[];
	/** The size of a card that the page has not measured yet. */
	card: NodeSize;
	/** The measured size of each card that the layout used. */
	sizes: ReadonlyMap<string, NodeSize>;
	/** How far the layout moved to keep the anchor card in its place. */
	shift: Point;
	/** Tells whether an anchor card held its place in this layout. */
	held: boolean;
};

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
	last: Pick<LaidGraph<unknown>, "kind" | "direction" | "shift"> | null,
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
 * Lays out the graph in a Web Worker, and keeps the last layout until the
 * next one lands. `failed` tells whether the latest layout was rejected.
 * A card is laid out at `span` until the page measures it, and a change to
 * a measured size lays out the graph again. Each layout keeps the `anchor`
 * card at the place that the anchor gives. `gap` is the distance from one
 * card to the next in the Layered layout.
 */
export function useLaidGraph<Source>(
	of: Source,
	input: LayoutInput,
	direction: GraphDirection,
	kind: GraphLayoutKind,
	span: NodeSize | null,
	anchor: RefObject<Anchor | null>,
	gap: FlowGap = flowGap,
): { laid: LaidGraph<Source> | null; failed: boolean } {
	const [laid, setLaid] = useState<LaidGraph<Source> | null>(null);
	const [failed, setFailed] = useState(false);
	const sizes = useNodeSizes(
		useMemo(() => input.cards.map((card) => card.id), [input]),
	);
	useEffect(() => {
		if (span === null) {
			return;
		}
		let current = true;
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
				if (current) {
					setLaid((last) => {
						const placed = anchored(
							layout,
							last,
							anchor.current,
							kind,
							direction,
						);
						return {
							of,
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
				}
			},
			(error: unknown) => {
				console.error(error);
				if (current) {
					setFailed(true);
				}
			},
		);
		return () => {
			current = false;
		};
	}, [of, direction, kind, input, sizes, span, anchor, gap]);
	return { laid, failed };
}

/**
 * Fits each new layout until the viewer moves the view away from the last
 * fit. A layout that holds an anchor card keeps the view. A change to
 * `refit` fits the view at once.
 */
export function FitLayout({
	layout,
	held,
	refit,
	fit,
}: {
	layout: GraphLayout;
	held: boolean;
	refit: number;
	fit: () => FitViewOptions;
}) {
	const flow = useReactFlow();
	const fitted = useRef<Viewport | null>(null);
	const asked = useRef(refit);
	useEffect(() => {
		void layout;
		const forced = asked.current !== refit;
		const last = fitted.current;
		const now = flow.getViewport();
		const away =
			last !== null &&
			(last.x !== now.x || last.y !== now.y || last.zoom !== now.zoom);
		if (!forced && (held || away)) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			asked.current = refit;
			void flow.fitView(fit()).then(() => {
				fitted.current = flow.getViewport();
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [flow, layout, held, refit, fit]);
	return null;
}
