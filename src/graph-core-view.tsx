import * as stylex from "@stylexjs/stylex";
import {
	type FitViewOptions,
	useReactFlow,
	type Viewport,
} from "@xyflow/react";
import ElkConstructor, { type ELK } from "elkjs/lib/elk-api.js";
import { type ReactNode, useEffect, useRef } from "react";

import { elkWorkerPath } from "./graph-core.ts";
import { FloatPanel } from "./graph-float.tsx";
import { floatPanelLabel } from "./terms.ts";
import { measure, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

let pageElk: ELK | null = null;

/** The one ELK of the page, in a Web Worker. */
export function elk(): ELK {
	pageElk ??= new ElkConstructor({
		workerFactory: () => new Worker(elkWorkerPath),
	});
	return pageElk;
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
	layout: unknown;
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

const legend = stylex.create({
	panel: {
		maxWidth: measure.legendCap,
	},
	list: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
	},
});

/** The float panel that holds the legend of a graph. The browser keeps its pin by `id`. */
export function LegendFrame({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<FloatPanel
			id={id}
			label={floatPanelLabel.legend}
			icon="map"
			grow="down"
			pin="last"
			layout={legend.panel}
		>
			<section aria-label={label} className={clsx(legend.list)}>
				{children}
			</section>
		</FloatPanel>
	);
}
