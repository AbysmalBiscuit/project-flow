import type { StyleXStyles } from "@stylexjs/stylex";
import { useStoreApi } from "@xyflow/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
	kindSize,
	measuredSizes,
	type NodeKind,
	type NodeSize,
	rememberNodeSize,
	subscribeNodeSizes,
} from "./graph-sizes.ts";
import { classToken } from "./ui.ts";

function readProbe(style: StyleXStyles, content: string): NodeSize | null {
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
	style: StyleXStyles,
	content = "\u00a0",
): NodeSize | null {
	const [attempt, setAttempt] = useState(0);
	const [size, setSize] = useState<NodeSize | null>(() =>
		readProbe(style, content),
	);
	useEffect(() => {
		if (size !== null || attempt >= 8) {
			return;
		}
		const next = readProbe(style, content);
		if (next !== null) {
			setSize(next);
			return;
		}
		const frame = requestAnimationFrame(() => {
			setAttempt((count) => count + 1);
		});
		return () => cancelAnimationFrame(frame);
	}, [attempt, content, size, style]);
	return size;
}

export function useNodeSpan(
	style: StyleXStyles,
	kind: NodeKind,
	content: string,
): NodeSize | null {
	const probed = useProbedSize(style, content);
	const drawn = useSyncExternalStore(subscribeNodeSizes, () => kindSize(kind));
	if (drawn.width > 0) {
		return drawn;
	}
	return probed;
}

/** The measured size of each of these nodes, the same map until a size changes. */
export function useNodeSizes(
	ids: readonly string[],
): ReadonlyMap<string, NodeSize> {
	const read = useMemo(() => {
		let last: ReadonlyMap<string, NodeSize> = new Map();
		return () => {
			last = measuredSizes(ids, last);
			return last;
		};
	}, [ids]);
	return useSyncExternalStore(subscribeNodeSizes, read);
}

export function MeasuredNode({ id, kind }: { id: string; kind: NodeKind }) {
	const store = useStoreApi();
	useEffect(() => {
		let observer: ResizeObserver | null = null;
		let frame = 0;
		const attach = () => {
			const content = document.getElementById(`graph-card-${id}`);
			const node = content?.parentElement;
			if (!(node instanceof HTMLDivElement) || content === null) {
				frame = requestAnimationFrame(attach);
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
				store
					.getState()
					.updateNodeInternals(
						new Map([[id, { id, nodeElement: node, force: true }]]),
					);
			};
			measure();
			observer = new ResizeObserver(measure);
			observer.observe(content);
		};
		attach();
		return () => {
			cancelAnimationFrame(frame);
			observer?.disconnect();
		};
	}, [id, kind, store]);
	return null;
}
