import { useReactFlow, type Viewport } from "@xyflow/react";
import ElkConstructor, { type ELK } from "elkjs/lib/elk-api.js";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectReport } from "./domain.ts";
import { fitPadding } from "./graph-float.tsx";
import { growGroups } from "./graph-force.ts";
import type { ForceRequest } from "./graph-force-worker.ts";
import {
	type Collapsed,
	elkWorkerPath,
	forceWorkerPath,
	type GraphLayout,
	type LayoutInput,
	layoutGraph,
	layoutInput,
	type Point,
} from "./graph-layout.ts";
import { headGrowth, titleGrowth } from "./graph-model.ts";
import { useNodeSizes } from "./graph-node-size.tsx";
import type { NodeSize } from "./graph-sizes.ts";
import type {
	GraphDirection,
	GraphLayoutKind,
	GroupBy,
} from "./view-settings.ts";

let pageElk: ELK | null = null;

function elk(): ELK {
	pageElk ??= new ElkConstructor({
		workerFactory: () => new Worker(elkWorkerPath),
	});
	return pageElk;
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

export type LaidGraph = {
	report: ProjectReport;
	direction: GraphDirection;
	kind: GraphLayoutKind;
	groupBy: GroupBy;
	input: LayoutInput;
	layout: GraphLayout;
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
	last: LaidGraph | null,
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
 * card at the place that the anchor gives.
 */
export function useLaidGraph(
	report: ProjectReport,
	direction: GraphDirection,
	kind: GraphLayoutKind,
	groupBy: GroupBy,
	assignees: readonly string[],
	collapsed: Collapsed,
	span: NodeSize | null,
	anchor: RefObject<Anchor | null>,
): { laid: LaidGraph | null; failed: boolean } {
	const [laid, setLaid] = useState<LaidGraph | null>(null);
	const [failed, setFailed] = useState(false);
	const input = useMemo(
		() => layoutInput(report, groupBy, assignees, collapsed),
		[report, groupBy, assignees, collapsed],
	);
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
					);
		laying.then(
			(layout) => {
				if (current) {
					setLaid((last) => ({
						report,
						direction,
						kind,
						groupBy,
						input,
						sizes,
						...anchored(layout, last, anchor.current, kind, direction),
					}));
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
	}, [report, direction, kind, groupBy, input, sizes, span, anchor]);
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
}: {
	layout: GraphLayout;
	held: boolean;
	refit: number;
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
			void flow.fitView({ padding: fitPadding, maxZoom: 1 }).then(() => {
				fitted.current = flow.getViewport();
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [flow, layout, held, refit]);
	return null;
}
