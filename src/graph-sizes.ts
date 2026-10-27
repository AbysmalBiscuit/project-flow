import type { Node as FlowNode } from "@xyflow/react";

export type NodeSize = { width: number; height: number };

export type NodeKind = "ticket" | "project";

const sizes = new Map<string, NodeSize>();
const kindSizes = new Map<NodeKind, NodeSize>();
const listeners = new Set<() => void>();
const emptySize: NodeSize = { width: 0, height: 0 };

export function subscribeNodeSizes(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function rememberNodeSize(
	id: string,
	size: NodeSize,
	kind: NodeKind,
): void {
	if (size.width <= 0 || size.height <= 0) {
		return;
	}
	const idChanged = writeSize(sizes, id, size);
	const kindChanged = writeKindSize(kind, size);
	if (!idChanged && !kindChanged) {
		return;
	}
	for (const listener of listeners) {
		listener();
	}
}

function writeSize<Key>(
	store: Map<Key, NodeSize>,
	key: Key,
	size: NodeSize,
): boolean {
	const previous = store.get(key);
	store.set(key, size);
	return previous?.width !== size.width || previous?.height !== size.height;
}

/**
 * Keeps the size of the shortest drawn node of a kind, so that a node that
 * grows does not change the span that the graph layout lays out with.
 */
function writeKindSize(kind: NodeKind, size: NodeSize): boolean {
	const previous = kindSizes.get(kind);
	if (
		previous !== undefined &&
		previous.width === size.width &&
		previous.height <= size.height
	) {
		return false;
	}
	kindSizes.set(kind, size);
	return true;
}

export function nodeSize(id: string, fallback: NodeSize): NodeSize {
	return sizes.get(id) ?? fallback;
}

/** The measured size of each of these nodes, or `previous` when none changed. */
export function measuredSizes(
	ids: readonly string[],
	previous: ReadonlyMap<string, NodeSize>,
): ReadonlyMap<string, NodeSize> {
	const next = new Map(
		ids.flatMap((id) => {
			const size = sizes.get(id);
			return size === undefined ? [] : [[id, size] as const];
		}),
	);
	const same =
		next.size === previous.size &&
		[...next].every(([id, size]) => {
			const before = previous.get(id);
			return before?.width === size.width && before.height === size.height;
		});
	return same ? previous : next;
}

export function kindSize(kind: NodeKind): NodeSize {
	return kindSizes.get(kind) ?? emptySize;
}

export function sizedNode<Node extends FlowNode>(
	node: Node,
	fallback: NodeSize,
): Node {
	const known = nodeSize(node.id, fallback);
	return {
		...node,
		width: known.width,
		height: known.height,
		initialWidth: known.width,
		initialHeight: known.height,
		measured: known,
	};
}
