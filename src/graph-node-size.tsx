import type { StyleXStyles } from "@stylexjs/stylex";
import { useStoreApi } from "@xyflow/react";
import {
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";

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
	const drawn = useMeasured(useCallback(() => kindSize(kind), [kind]));
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
	return useMeasured(read);
}

/**
 * Reads the measured sizes, and renders again in a transition when they change.
 * React splits a transition into short tasks, so a large graph keeps the page responsive.
 */
function useMeasured<Value>(read: () => Value): Value {
	const value = read();
	const [, setTurn] = useState(0);
	useEffect(() => {
		const changed = () => startTransition(() => setTurn((turn) => turn + 1));
		const stop = subscribeNodeSizes(changed);
		if (read() !== value) {
			changed();
		}
		return stop;
	}, [read, value]);
	return value;
}

type FlowStore = ReturnType<typeof useStoreApi>;
type NodeUpdate = { id: string; nodeElement: HTMLDivElement; force: true };
type Measured = { store: FlowStore; measure: () => NodeUpdate | null };

const measuredCards = new Map<Element, Measured>();
let cardObserver: ResizeObserver | null = null;

function updateNodes(measured: Iterable<Measured>): void {
	const updates = new Map<FlowStore, Map<string, NodeUpdate>>();
	for (const { store, measure } of measured) {
		const update = measure();
		if (update !== null) {
			updates.set(
				store,
				(updates.get(store) ?? new Map()).set(update.id, update),
			);
		}
	}
	for (const [store, nodes] of updates) {
		store.getState().updateNodeInternals(nodes);
	}
}

/**
 * Watches every card with one ResizeObserver, so a size change renders the graph once.
 * One callback carries every changed card, so React Flow updates once, not once per card.
 */
function observeCard(content: Element, measured: Measured): () => void {
	cardObserver ??= new ResizeObserver((entries) =>
		updateNodes(
			entries.flatMap((entry) => measuredCards.get(entry.target) ?? []),
		),
	);
	measuredCards.set(content, measured);
	cardObserver.observe(content);
	return () => {
		measuredCards.delete(content);
		cardObserver?.unobserve(content);
	};
}

export function MeasuredNode({ id, kind }: { id: string; kind: NodeKind }) {
	const store = useStoreApi();
	useEffect(() => {
		let unobserve = () => {};
		let frame = 0;
		const attach = () => {
			const content = document.getElementById(`graph-card-${id}`);
			const node = content?.parentElement;
			if (!(node instanceof HTMLDivElement) || content === null) {
				frame = requestAnimationFrame(attach);
				return;
			}
			let sized = false;
			const measure = (): NodeUpdate | null => {
				const width = content.offsetWidth;
				const height = content.offsetHeight;
				if (width <= 0 || height <= 0) {
					return null;
				}
				rememberNodeSize(id, { width, height }, kind);
				// React Flow observes the node too, and updates it on the same
				// first sized frame.
				const first = !sized;
				sized = true;
				if (
					first ||
					node.offsetWidth !== width ||
					node.offsetHeight !== height
				) {
					return null;
				}
				return { id, nodeElement: node, force: true };
			};
			unobserve = observeCard(content, { store, measure });
		};
		attach();
		return () => {
			cancelAnimationFrame(frame);
			unobserve();
		};
	}, [id, kind, store]);
	return null;
}
