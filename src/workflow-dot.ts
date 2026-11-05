import type { RunSource } from "./domain.ts";
import type { RunGraph, RunGraphNode } from "./run-domain.ts";

/** One graph of a workflow package, by its path in the package. */
export type WorkflowGraph = { name: string; graph: RunGraph };

type Attrs = Record<string, string>;
type Token = { text: string; quoted: boolean };

/** The workcell handler of each node shape. A node with another shape runs `codergen`. */
const shapeKinds: Readonly<Record<string, string>> = {
	Mdiamond: "start",
	Msquare: "exit",
	box: "codergen",
	hexagon: "wait.human",
	diamond: "conditional",
	component: "parallel",
	tripleoctagon: "parallel.fan_in",
	parallelogram: "tool",
	house: "stack.manager_loop",
};

const graphFile = ".dot";
const tokenShape =
	/\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"((?:[^"\\]|\\.)*)"|(->|[{}[\];,=])|([\w.]+)/y;

function tokensOf(text: string): Token[] {
	const tokens: Token[] = [];
	tokenShape.lastIndex = 0;
	while (tokenShape.lastIndex < text.length) {
		const at = tokenShape.lastIndex;
		const match = tokenShape.exec(text);
		if (match === null) {
			throw new Error(`DOT text has an unknown token at ${at}`);
		}
		const [, quoted, symbol, id] = match;
		if (quoted !== undefined) {
			tokens.push({ text: quoted.replace(/\\(["\\])/g, "$1"), quoted: true });
		} else if (symbol !== undefined || id !== undefined) {
			tokens.push({ text: symbol ?? id ?? "", quoted: false });
		}
	}
	return tokens;
}

const isSymbol = (token: Token | undefined, symbol: string) =>
	token !== undefined && !token.quoted && token.text === symbol;

/**
 * The nodes and edges of the DOT text of one workcell graph.
 * It reads node, edge, chained edge and attribute statements, and skips subgraph blocks.
 */
function parseDot(text: string) {
	const tokens = tokensOf(text);
	const nodes = new Map<string, Attrs>();
	const edges: { from: string; to: string; attrs: Attrs }[] = [];
	let nodeDefaults: Attrs = {};
	let at = tokens.findIndex((token) => isSymbol(token, "{")) + 1;
	const attrList = (): Attrs => {
		const attrs: Attrs = {};
		if (!isSymbol(tokens[at], "[")) {
			return attrs;
		}
		at += 1;
		while (at < tokens.length && !isSymbol(tokens[at], "]")) {
			const key = tokens[at];
			const value = tokens[at + 2];
			if (
				key !== undefined &&
				value !== undefined &&
				isSymbol(tokens[at + 1], "=")
			) {
				attrs[key.text] = value.text;
				at += 3;
			} else {
				at += 1;
			}
		}
		at += 1;
		return attrs;
	};
	const node = (id: string, attrs: Attrs = {}) => {
		nodes.set(id, { ...nodeDefaults, ...nodes.get(id), ...attrs });
	};
	for (let depth = 1; at < tokens.length && depth > 0;) {
		const token = tokens[at];
		if (token === undefined || isSymbol(token, ";") || isSymbol(token, ",")) {
			at += 1;
			continue;
		}
		if (isSymbol(token, "{") || isSymbol(token, "}")) {
			depth += isSymbol(token, "{") ? 1 : -1;
			at += 1;
			continue;
		}
		if (!token.quoted && token.text === "subgraph") {
			at += isSymbol(tokens[at + 1], "{") ? 1 : 2;
			continue;
		}
		at += 1;
		if (isSymbol(tokens[at], "=")) {
			at += 2;
			continue;
		}
		if (!token.quoted && ["graph", "node", "edge"].includes(token.text)) {
			const attrs = attrList();
			if (token.text === "node") {
				nodeDefaults = { ...nodeDefaults, ...attrs };
			}
			continue;
		}
		const chain = [token.text];
		while (isSymbol(tokens[at], "->")) {
			const next = tokens[at + 1];
			if (next === undefined) {
				break;
			}
			chain.push(next.text);
			at += 2;
		}
		const attrs = attrList();
		if (chain.length === 1) {
			node(token.text, attrs);
			continue;
		}
		for (const id of chain) {
			if (!nodes.has(id)) {
				node(id);
			}
		}
		for (const [index, to] of chain.slice(1).entries()) {
			edges.push({ from: chain[index] ?? to, to, attrs });
		}
	}
	return { nodes, edges };
}

/** The graph files that a node calls, from its `prompt_file` or `graph` attribute. */
export function callsOf(attrs: Readonly<Record<string, unknown>>): string[] {
	return [attrs.prompt_file, attrs.graph].filter(
		(value): value is string =>
			typeof value === "string" && value.endsWith(graphFile),
	);
}

/** A parsed graph, with the graph files that its nodes call. */
export type CallingGraph = { graph: RunGraph; calls: string[] };

/**
 * The entry graph, then each graph that a run can call from it, in call order.
 * `read` gives a graph by its path, or undefined when the package has no such graph.
 */
export function inCallOrder(
	entry: string,
	read: (name: string) => CallingGraph | undefined,
): WorkflowGraph[] {
	const graphs: WorkflowGraph[] = [];
	const queue = [entry];
	const seen = new Set(queue);
	for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
		const found = read(name);
		if (found === undefined) {
			continue;
		}
		graphs.push({ name, graph: found.graph });
		for (const call of found.calls) {
			if (!seen.has(call)) {
				seen.add(call);
				queue.push(call);
			}
		}
	}
	return graphs;
}

function runGraphOf(text: string): CallingGraph {
	const { nodes, edges } = parseDot(text);
	return {
		graph: {
			nodes: [...nodes].map(([id, attrs]): RunGraphNode => {
				const shape = attrs.shape ?? "box";
				return {
					id,
					label: attrs.label ?? id,
					shape,
					kind: attrs.type ?? shapeKinds[shape] ?? "codergen",
					...(attrs.class === undefined ? {} : { role: attrs.class }),
					state: "ahead",
					visits: 0,
					retries: 0,
				};
			}),
			edges: edges.map(({ from, to, attrs }) => ({
				from,
				to,
				...(attrs.label === undefined ? {} : { label: attrs.label }),
				...(attrs.condition === undefined
					? {}
					: { condition: attrs.condition }),
			})),
		},
		calls: [...nodes.values()].flatMap(callsOf),
	};
}

/** The entry graph of a workflow source, then each graph that a run can call from it, in call order. */
export function sourceGraphs(source: RunSource): WorkflowGraph[] {
	const texts = new Map(source.graphs.map((graph) => [graph.path, graph.text]));
	return inCallOrder(source.entry, (name) => {
		const text = texts.get(name);
		return text === undefined ? undefined : runGraphOf(text);
	});
}
