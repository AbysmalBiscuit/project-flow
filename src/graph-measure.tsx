import type { StyleXStyles } from "@stylexjs/stylex";
import { useStoreApi } from "@xyflow/react";
import { useEffect, useState } from "react";
import { type NodeSize, rememberNodeSize } from "./graph-measure.ts";
import { classToken } from "./ui.ts";

type Style = StyleXStyles;

function readProbe(style: Style, content: string): NodeSize | null {
	if (typeof document === "undefined") {
		return null;
	}
	const probe = document.createElement("span");
	probe.className = classToken(style);
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.textContent = content;
	document.body.append(probe);
	const box = probe.getBoundingClientRect();
	probe.remove();
	if (box.width <= 0 || box.height <= 0) {
		return null;
	}
	return { width: box.width, height: box.height };
}

export function useProbedSize(
	style: Style,
	content = "\u00a0",
): NodeSize | null {
	const [size, setSize] = useState<NodeSize | null>(() =>
		readProbe(style, content),
	);
	useEffect(() => {
		if (size !== null) {
			return;
		}
		const next = readProbe(style, content);
		if (next !== null) {
			setSize(next);
		}
	}, [size, style, content]);
	return size;
}

export function MeasuredNode({ id, kind }: { id: string; kind?: string }) {
	const store = useStoreApi();
	useEffect(() => {
		const node = document.querySelector(
			`.react-flow__node[data-id="${CSS.escape(id)}"]`,
		);
		const content = node?.firstElementChild;
		if (!(node instanceof HTMLElement) || !(content instanceof HTMLElement)) {
			return;
		}
		const measure = () => {
			const width = content.offsetWidth;
			const height = content.offsetHeight;
			if (width <= 0 || height <= 0) {
				return;
			}
			rememberNodeSize(id, { width, height }, kind);
			if (node.offsetWidth !== width || node.offsetHeight !== height) {
				return;
			}
			if (!(node instanceof HTMLDivElement)) {
				return;
			}
			store
				.getState()
				.updateNodeInternals(
					new Map([[id, { id, nodeElement: node, force: true }]]),
				);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, [id, kind, store]);
	return null;
}
