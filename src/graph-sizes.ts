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
	const kindChanged = writeSize(kindSizes, kind, size);
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

export function nodeSize(id: string, fallback: NodeSize): NodeSize {
	return sizes.get(id) ?? fallback;
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
