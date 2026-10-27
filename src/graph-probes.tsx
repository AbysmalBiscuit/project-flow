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

/** The box of an overlay part: its float panel when open, else its button. */
function partBox(part: HTMLElement): DOMRect {
	const body =
		part.dataset.open === "open"
			? part.querySelector("[data-float-body]")
			: null;
	return (body ?? part).getBoundingClientRect();
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
	const bottom = Math.max(...parts.map((part) => partBox(part).bottom));
	return {
		padding: {
			top: `${bottom - box.top + margin}px`,
			x: fitPadding,
			bottom: fitPadding,
		},
		maxZoom: 1,
	};
}

function overlayClear(paneId: string): boolean | null {
	const pane = document.getElementById(paneId);
	const parts = overlayParts(pane);
	if (pane === null || parts.length === 0) {
		return null;
	}
	const nodes = [...pane.querySelectorAll(".react-flow__node")].map((node) =>
		node.getBoundingClientRect(),
	);
	return parts.every((part) => {
		const box = partBox(part);
		return nodes.every((node) => boxesApart(box, node));
	});
}

/** Reports whether the overlay covers a card or a frame in the current view. */
export function OverlayProbe({
	probe,
	paneId,
}: {
	probe: string;
	paneId: string;
}) {
	const transform = useStore((state) => state.transform);
	const nodes = useStore((state) => state.nodes);
	const [clear, setClear] = useState<boolean | null>(null);
	useEffect(() => {
		void transform;
		void nodes;
		const frame = requestAnimationFrame(() => setClear(overlayClear(paneId)));
		return () => cancelAnimationFrame(frame);
	}, [transform, nodes, paneId]);
	return (
		<p id={`${probe}-legend`} className={clsx(cards.graphProbe)}>
			{clear === null ? "" : clear ? "legend-clear" : "legend-covers"}
		</p>
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
