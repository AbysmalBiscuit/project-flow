import { useReactFlow, type Viewport } from "@xyflow/react";
import { useEffect, useState } from "react";
import { overviewControlLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards } from "./ui-styles.ts";

export function columnDepth(
	ids: Iterable<string>,
	incoming: Map<string, string[]>,
): Map<string, number> {
	const depth = new Map<string, number>();
	const visit = (name: string, seen: Set<string>): number => {
		const known = depth.get(name);
		if (known !== undefined) {
			return known;
		}
		if (seen.has(name)) {
			return 0;
		}
		seen.add(name);
		const sources = incoming.get(name) ?? [];
		const next =
			sources.length === 0
				? 0
				: Math.max(...sources.map((source) => visit(source, seen))) + 1;
		depth.set(name, next);
		return next;
	};
	for (const id of ids) {
		visit(id, new Set());
	}
	return depth;
}

function viewportElement(root: ParentNode): HTMLElement | SVGElement | null {
	const pane = root.querySelector(".react-flow__viewport");
	if (!(pane instanceof SVGElement) && !(pane instanceof HTMLElement)) {
		return null;
	}
	return pane;
}

export function readViewport(root: ParentNode = document): Viewport | null {
	const pane = viewportElement(root);
	if (pane === null) {
		return null;
	}
	const transform = pane.style.transform;
	const shift = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(transform);
	const scale = /scale\(([^)]+)\)/.exec(transform)?.[1];
	const x = shift?.[1];
	const y = shift?.[2];
	if (scale === undefined || x === undefined || y === undefined) {
		return null;
	}
	return {
		x: Math.round(Number(x)),
		y: Math.round(Number(y)),
		zoom: Math.round(Number(scale) * 1000) / 1000,
	};
}

function watchViewport(
	setViewport: (viewport: Viewport | null) => void,
	root: ParentNode,
): () => void {
	let stopped = false;
	let observer: MutationObserver | null = null;
	const publish = () => {
		if (!stopped) {
			setViewport(readViewport(root));
		}
	};
	const attach = () => {
		if (stopped || observer !== null) {
			return;
		}
		const pane = viewportElement(root);
		if (pane === null) {
			return;
		}
		observer = new MutationObserver(publish);
		observer.observe(pane, {
			attributes: true,
			attributeFilter: ["style"],
		});
		publish();
	};
	let last = "";
	let frames = 0;
	const tick = () => {
		if (stopped) {
			return;
		}
		const pane = viewportElement(root);
		const transform = pane?.style.transform ?? "";
		frames += 1;
		if ((transform === "" || transform !== last) && frames < 40) {
			last = transform;
			requestAnimationFrame(tick);
			return;
		}
		attach();
		if (observer === null) {
			publish();
		}
	};
	const frame = requestAnimationFrame(tick);
	return () => {
		stopped = true;
		cancelAnimationFrame(frame);
		observer?.disconnect();
	};
}

export function GraphTools({
	probeId = "graph-viewport",
	fitId,
	scope = "",
}: {
	probeId?: string;
	fitId?: string;
	scope?: string;
}) {
	const flow = useReactFlow();
	const [viewport, setViewport] = useState<Viewport | null>(null);
	useEffect(
		() =>
			watchViewport(
				setViewport,
				scope === "" ? document : (document.querySelector(scope) ?? document),
			),
		[scope],
	);
	const show = () => {
		const root =
			scope === "" ? document : (document.querySelector(scope) ?? document);
		setViewport(readViewport(root));
	};
	return (
		<div className={clsx(cards.graphTools)}>
			<button
				type="button"
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.zoomOut}
				onClick={() => {
					void flow.zoomOut().then(show);
				}}
			>
				−
			</button>
			<button
				type="button"
				id={fitId}
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.fit}
				onClick={() => {
					void flow.fitView().then(show);
				}}
			>
				{overviewControlLabel.fit}
			</button>
			<button
				type="button"
				className={clsx(cards.graphTool)}
				aria-label={overviewControlLabel.zoomIn}
				onClick={() => {
					void flow.zoomIn().then(show);
				}}
			>
				+
			</button>
			<p id={probeId} className={clsx(cards.graphProbe)}>
				{viewport === null
					? ""
					: `zoom ${viewport.zoom} at ${viewport.x},${viewport.y}`}
			</p>
		</div>
	);
}
