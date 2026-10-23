import { useReactFlow, type Viewport } from "@xyflow/react";
import ElkConstructor, { type ELK } from "elkjs/lib/elk-api.js";
import { useEffect, useRef, useState } from "react";
import type { ProjectReport } from "./domain.ts";
import { fitPadding } from "./graph-float.tsx";
import { growGroups } from "./graph-force.ts";
import type { ForceRequest } from "./graph-force-worker.ts";
import {
	elkWorkerPath,
	forceWorkerPath,
	type GraphLayout,
	type LayoutInput,
	layoutGraph,
	layoutInput,
} from "./graph-layout.ts";
import { headGrowth, titleGrowth } from "./graph-model.ts";
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
): Promise<GraphLayout> {
	const worker = new Worker(forceWorkerPath, { type: "module" });
	const request: ForceRequest = {
		input,
		card,
		titles: new Map(
			input.frames.map((frame) => [frame.title, titleGrowth(frame.title)]),
		),
	};
	const layout = await new Promise<GraphLayout>((resolve, reject) => {
		worker.onmessage = (event: MessageEvent<GraphLayout>) =>
			resolve(event.data);
		worker.onerror = (event) => reject(new Error(event.message));
		worker.postMessage(request);
	}).finally(() => worker.terminate());
	return growGroups(input, layout, card, headGrowth);
}

export type LaidGraph = {
	report: ProjectReport;
	direction: GraphDirection;
	kind: GraphLayoutKind;
	groupBy: GroupBy;
	input: LayoutInput;
	layout: GraphLayout;
};

/**
 * Lays out the graph in a Web Worker, and keeps the last layout until the
 * next one lands. `failed` tells whether the latest layout was rejected.
 */
export function useLaidGraph(
	report: ProjectReport,
	direction: GraphDirection,
	kind: GraphLayoutKind,
	groupBy: GroupBy,
	assignees: readonly string[],
	span: NodeSize | null,
): { laid: LaidGraph | null; failed: boolean } {
	const [laid, setLaid] = useState<LaidGraph | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (span === null) {
			return;
		}
		let current = true;
		const input = layoutInput(report, groupBy, assignees);
		const laying =
			kind === "force"
				? forceInWorker(input, span)
				: layoutGraph(elk(), input, direction, span, headGrowth, titleGrowth);
		laying.then(
			(layout) => {
				if (current) {
					setLaid({ report, direction, kind, groupBy, input, layout });
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
	}, [report, direction, kind, groupBy, assignees, span]);
	return { laid, failed };
}

/** Fits each new layout until the viewer moves the view away from the last fit. */
export function FitLayout({ layout }: { layout: GraphLayout }) {
	const flow = useReactFlow();
	const fitted = useRef<Viewport | null>(null);
	useEffect(() => {
		void layout;
		const last = fitted.current;
		const now = flow.getViewport();
		if (
			last !== null &&
			(last.x !== now.x || last.y !== now.y || last.zoom !== now.zoom)
		) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			void flow.fitView({ padding: fitPadding, maxZoom: 1 }).then(() => {
				fitted.current = flow.getViewport();
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [flow, layout]);
	return null;
}
