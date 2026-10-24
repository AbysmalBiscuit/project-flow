import { type FitViewOptions, useStore } from "@xyflow/react";
import { useEffect, useState } from "react";

import { cards } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

export const fitPadding = 0.28;

function boxesApart(one: DOMRect, other: DOMRect): boolean {
	return (
		Math.round(one.right) <= Math.round(other.left) ||
		Math.round(other.right) <= Math.round(one.left) ||
		Math.round(one.bottom) <= Math.round(other.top) ||
		Math.round(other.bottom) <= Math.round(one.top)
	);
}

function overlayParts(pane: Element | null): HTMLElement[] {
	return [
		...(pane?.querySelector("[data-graph-overlay]")?.children ?? []),
	].filter((part): part is HTMLElement => part instanceof HTMLElement);
}

/**
 * Fits the graph below the overlay of the pane. The top padding is the
 * overlay height plus the fit padding, so no card or frame lies under it.
 */
export function overlayFit(paneId: string): FitViewOptions {
	const pane = document.getElementById(paneId);
	const parts = overlayParts(pane);
	if (pane === null || parts.length === 0) {
		return { padding: fitPadding, maxZoom: 1 };
	}
	const box = pane.getBoundingClientRect();
	const margin = (box.height - box.height / (1 + fitPadding)) / 2;
	const bottom = Math.max(
		...parts.map((part) => part.getBoundingClientRect().bottom),
	);
	return {
		padding: {
			top: `${bottom - box.top + margin}px`,
			x: fitPadding,
			bottom: fitPadding,
		},
		maxZoom: 1,
	};
}

type Clear = { overlay: boolean; scope: boolean | null };

function overlayClear(paneId: string, scopeId: string): Clear | null {
	const pane = document.getElementById(paneId);
	const parts = overlayParts(pane);
	if (pane === null || parts.length === 0) {
		return null;
	}
	const nodes = [...pane.querySelectorAll(".react-flow__node")].map((node) =>
		node.getBoundingClientRect(),
	);
	const misses = (box: DOMRect) => nodes.every((node) => boxesApart(box, node));
	const scope = parts.find((part) => part.id === scopeId);
	const scopeBox = scope?.getBoundingClientRect();
	return {
		overlay: parts.every((part) => misses(part.getBoundingClientRect())),
		scope:
			scopeBox === undefined
				? null
				: misses(scopeBox) &&
					parts.every(
						(part) =>
							part === scope ||
							boxesApart(scopeBox, part.getBoundingClientRect()),
					),
	};
}

/**
 * Reports whether the overlay covers a card or a frame in the current view,
 * and whether the scope line covers a card, a frame or another overlay part.
 */
export function OverlayProbe({
	probe,
	paneId,
}: {
	probe: string;
	paneId: string;
}) {
	const transform = useStore((state) => state.transform);
	const nodes = useStore((state) => state.nodes);
	const [clear, setClear] = useState<Clear | null>(null);
	useEffect(() => {
		void transform;
		void nodes;
		const frame = requestAnimationFrame(() =>
			setClear(overlayClear(paneId, `${probe}-scope`)),
		);
		return () => cancelAnimationFrame(frame);
	}, [transform, nodes, paneId, probe]);
	return (
		<>
			<p id={`${probe}-legend`} className={clsx(cards.graphProbe)}>
				{clear === null ? "" : clear.overlay ? "legend-clear" : "legend-covers"}
			</p>
			<p id={`${probe}-scope-clear`} className={clsx(cards.graphProbe)}>
				{clear?.scope == null
					? ""
					: clear.scope
						? "scope-clear"
						: "scope-covers"}
			</p>
		</>
	);
}

/** Tells how the pane, the overlay and the controls sit in the graph box. */
function publishLayout(root: string, probe: string): void {
	const out = document.getElementById(`${probe}-layout`);
	const box = document.getElementById(root);
	const pane = document.getElementById(`${probe}-pane`);
	const controls = document.getElementById(`${probe}-controls`);
	if (out === null || box === null || pane === null || controls === null) {
		return;
	}
	const floats = [...controls.querySelectorAll(":scope > * > *")].map((part) =>
		part.getBoundingClientRect(),
	);
	const apart = overlayParts(pane).every((part) => {
		const at = part.getBoundingClientRect();
		return floats.every((float) => boxesApart(at, float));
	});
	const paneBox = pane.getBoundingClientRect();
	const rootBox = box.getBoundingClientRect();
	const border = Number.parseFloat(getComputedStyle(box).borderTopWidth);
	const edge = Number.isFinite(border) ? border : 0;
	const flush =
		Math.round(paneBox.top - edge) === Math.round(rootBox.top) &&
		Math.round(paneBox.bottom + edge) === Math.round(rootBox.bottom);
	const controlsBox = controls.getBoundingClientRect();
	const corner =
		Math.round(controlsBox.left) === Math.round(paneBox.left) &&
		Math.round(controlsBox.bottom) === Math.round(paneBox.bottom);
	const page = document.documentElement;
	const fits = page.scrollWidth === page.clientWidth;
	out.textContent = [
		flush ? "canvas-flush" : "canvas-offset",
		apart ? "floats-apart" : "floats-cover",
		fits ? "page-fits" : "page-scrolls",
		corner ? "controls-corner" : "controls-moved",
	].join(" ");
}

export function watchLayout(root: string, probe: string): () => void {
	const box = document.getElementById(root);
	const pane = document.getElementById(`${probe}-pane`);
	const controls = document.getElementById(`${probe}-controls`);
	if (box === null || pane === null || controls === null) {
		return () => {};
	}
	const publish = () => publishLayout(root, probe);
	publish();
	const observer = new ResizeObserver(publish);
	for (const part of [
		box,
		document.documentElement,
		...overlayParts(pane),
		...controls.querySelectorAll(":scope > * > *"),
	]) {
		observer.observe(part);
	}
	return () => observer.disconnect();
}
