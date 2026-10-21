import type { Node as FlowNode } from "@xyflow/react";

export type NodeSize = { width: number; height: number };

const sizes = new Map<string, NodeSize>();
const listeners = new Set<() => void>();

export function subscribeNodeSizes(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function rememberNodeSize(
	id: string,
	size: NodeSize,
	kind?: string,
): void {
	if (size.width <= 0 || size.height <= 0) {
		return;
	}
	const changed = writeSize(id, size) || writeSize(kind, size);
	if (!changed) {
		return;
	}
	for (const listener of listeners) {
		listener();
	}
}

function writeSize(id: string | undefined, size: NodeSize): boolean {
	if (id === undefined) {
		return false;
	}
	const previous = sizes.get(id);
	sizes.set(id, size);
	return previous?.width !== size.width || previous.height !== size.height;
}

export function nodeSize(id: string, fallback: NodeSize): NodeSize {
	return sizes.get(id) ?? fallback;
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
