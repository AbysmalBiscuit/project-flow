import { z } from "zod";

import {
	type FactoryRun,
	resumableRunStatusKinds,
	type RunAgent,
	type RunCheckpoint,
	type RunDetail,
	type RunEvent,
	type RunGraph,
	type RunStage,
	type RunUsage,
} from "./domain.ts";
import {
	body,
	NotServed,
	type Read,
	reader,
	Unreachable,
} from "./factory-http.ts";
import { isLive, type ReadRun, type StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";
import { runUsage } from "./run-usage.ts";

export type CheckpointRead = RunCheckpoint | "missing" | "not served";

export const checkpoint = z.object({
	current_node: z.string(),
	stack: z.array(z.object({ node: z.string() })).optional(),
	completed_nodes: z.array(z.string()).default([]),
	node_retries: z.record(z.string(), z.number()).default({}),
	visits: z.record(z.string(), z.number()).default({}),
	status: z.string().optional(),
	context_values: z.record(z.string(), z.unknown()).default({}),
});

/** `GET /runs/{id}/turns`: one summary for each finished agent turn of the run. */
const turns = z.object({
	turns: z.array(
		z.object({
			node_path: z.string(),
			tools: z.record(z.string(), z.number()),
			tokens: z.object({ input: z.number(), output: z.number() }),
			cost_usd: z.number(),
			duration_s: z.number(),
		}),
	),
});

/** The live counters of each worker of a run, by node path. */
const workers = z.object({
	workers: z.record(
		z.string(),
		z.object({
			current_tool: z.string(),
			last_message: z.string(),
			turn: z.enum(["running", "ended"]),
		}),
	),
});

/** The current node path: the caller node of each child graph, then the current node. */
export function stagePath(answer: z.infer<typeof checkpoint>): string {
	return [
		...(answer.stack ?? []).map((frame) => frame.node),
		answer.current_node,
	]
		.filter((node) => node !== "")
		.join("/");
}

/** The `GET /runs/{id}/graph` answer: the frozen entry graph of the run's workflow. */
const workflowGraph = z.object({
	name: z.string().optional(),
	nodes: z.array(
		z.object({
			id: z.string(),
			attrs: z
				.object({
					label: z.string().optional(),
					shape: z.string().optional(),
					prompt_file: z.string().optional(),
				})
				.default({}),
			handler: z.string().optional(),
		}),
	),
	edges: z.array(
		z.object({
			from: z.string(),
			to: z.string(),
			attrs: z
				.object({
					label: z.string().optional(),
					condition: z.string().optional(),
				})
				.default({}),
		}),
	),
});

/** Each call of a child graph opens at one of these start nodes. */
const startNodes = new Set(["start", "Start"]);

/**
 * The child stages of each caller node, over all its calls. The checkpoint
 * lists the completed nodes of each graph in one list. An ended call adds its
 * completed nodes, then its caller node. A call closes at a caller node that
 * ends the list or that a successor of the caller follows, because a child
 * graph can have a node of the same name. The live call of the outer child
 * graph runs from its start node to the end of the list, then its current node.
 */
function callStages(
	graph: z.infer<typeof workflowGraph>,
	answer: z.infer<typeof checkpoint>,
	callers: ReadonlySet<string>,
	failed: boolean,
): Map<string, RunStage[]> {
	const successors = new Map<string, Set<string>>();
	for (const edge of graph.edges) {
		successors.set(
			edge.from,
			(successors.get(edge.from) ?? new Set()).add(edge.to),
		);
	}
	const stages = new Map<string, RunStage[]>();
	const add = (caller: string, nodes: string[]) => {
		const known = stages.get(caller) ?? [];
		for (const node of nodes) {
			const id = `${caller}/${node}`;
			const seen = known.find((stage) => stage.id === id);
			if (seen === undefined) {
				known.push({
					id,
					label: node,
					state: "completed",
					visits: 1,
					retries: 0,
				});
			} else {
				seen.visits += 1;
			}
		}
		stages.set(caller, known);
	};
	const nodes = answer.completed_nodes;
	const stack = answer.stack ?? [];
	const starts = nodes.flatMap((node, index) =>
		startNodes.has(node) ? [index] : [],
	);
	const liveFrom =
		stack.length === 0
			? nodes.length
			: (starts.at(-stack.length) ?? nodes.length);
	const ended = nodes.slice(0, liveFrom);
	let from: number | undefined;
	ended.forEach((node, index) => {
		if (from === undefined) {
			from = index > 0 && startNodes.has(node) ? index : undefined;
			return;
		}
		const next = ended[index + 1];
		if (
			callers.has(node) &&
			(next === undefined || successors.get(node)?.has(next))
		) {
			add(node, ended.slice(from, index));
			from = undefined;
		}
	});
	const caller = stack[0]?.node;
	if (caller !== undefined) {
		const current = stack[1]?.node ?? answer.current_node;
		const to = stack.length === 1 ? undefined : starts.at(1 - stack.length);
		add(caller, [...nodes.slice(liveFrom, to), current]);
		const live = stages
			.get(caller)
			?.find((stage) => stage.id === `${caller}/${current}`);
		if (live !== undefined) {
			live.state = failed ? "failed" : "current";
		}
	}
	return stages;
}

/**
 * The graph of a run with the checkpoint state of each top-level node. A child
 * graph runs inside its caller node, so the caller node is the current one.
 */
function runGraph(
	graph: z.infer<typeof workflowGraph>,
	answer: z.infer<typeof checkpoint>,
): RunGraph {
	const current = stagePath(answer).split("/")[0];
	const completed = new Set(answer.completed_nodes);
	const failed = answer.status === "fail";
	const callers = new Set(
		graph.nodes
			.filter((node) => (node.attrs.prompt_file ?? "").trim() !== "")
			.map((node) => node.id),
	);
	const children = callStages(graph, answer, callers, failed);
	return {
		nodes: graph.nodes.map((node) => {
			const calls = callers.has(node.id);
			return {
				id: node.id,
				label: node.attrs.label ?? node.id,
				shape: node.attrs.shape ?? "box",
				kind: node.handler ?? "codergen",
				state:
					node.id === current
						? failed
							? "failed"
							: "current"
						: completed.has(node.id)
							? "completed"
							: "ahead",
				visits: answer.visits[node.id] ?? 0,
				retries: answer.node_retries[node.id] ?? 0,
				...(calls ? { child: children.get(node.id) ?? [] } : {}),
			};
		}),
		edges: graph.edges.map((edge) => ({
			from: edge.from,
			to: edge.to,
			...(edge.attrs.label === undefined ? {} : { label: edge.attrs.label }),
			...(edge.attrs.condition === undefined
				? {}
				: { condition: edge.attrs.condition }),
		})),
	};
}

/** The usage of a run from its recorded turns. A factory that gives no turns leaves it unknown. */
async function usageOf(
	read: Read,
	id: string,
): Promise<RunUsage | "not served" | null> {
	try {
		const listed = await body(
			await read(`/runs/${encodeURIComponent(id)}/turns`),
			turns,
		);
		return runUsage(
			listed.turns.map((turn) => ({
				nodePath: turn.node_path,
				usage: {
					inputTokens: turn.tokens.input,
					outputTokens: turn.tokens.output,
					costUsd: turn.cost_usd,
					durationS: turn.duration_s,
					tools: turn.tools,
				},
			})),
		);
	} catch (error) {
		if (error instanceof NotServed) {
			return "not served";
		}
		if (!(error instanceof Unreachable)) {
			throw error;
		}
		return null;
	}
}

/** The reads of one run's detail from the factory row that gives the run its status. */
export function runDetailReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
	runs: () => FactoryRun[];
	stages: ReadonlyMap<string, string>;
	lastEvents: ReadonlyMap<string, RunEvent>;
}) {
	const { fetchImpl, signal, statusRowOf, runs, stages, lastEvents } = deps;
	/** A run's workflow graph does not change while it runs, so the first good read stays. */
	const graphs = new Map<string, z.infer<typeof workflowGraph>>();
	const graphOf = async (
		read: Read,
		runId: string,
	): Promise<z.infer<typeof workflowGraph> | null> => {
		const known = graphs.get(runId);
		if (known !== undefined) {
			return known;
		}
		try {
			const graph = await body(
				await read(`/runs/${encodeURIComponent(runId)}/graph`),
				workflowGraph,
			);
			graphs.set(runId, graph);
			return graph;
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return null;
		}
	};
	const runCheckpoint = async (runId: string): Promise<CheckpointRead> => {
		const { hubRow, row } = statusRowOf(runId);
		const target = hubRow ?? row;
		if (target === undefined) {
			return "missing";
		}
		const read = reader(fetchImpl, target.url, signal);
		const usage = usageOf(read, runId);
		try {
			const [answer, graph] = await Promise.all([
				read(`/runs/${encodeURIComponent(runId)}/checkpoint`).then((response) =>
					body(response, checkpoint),
				),
				graphOf(read, runId),
			]);
			const stage = stagePath(answer);
			const used = await usage;
			return {
				stage: stage === "" ? null : stage,
				completedStages: answer.completed_nodes,
				retries: answer.node_retries,
				visits: answer.visits,
				context: answer.context_values,
				...(used === null
					? {}
					: used === "not served"
						? { usageNotServed: true }
						: { usage: used }),
				graph: graph === null ? null : runGraph(graph, answer),
			};
		} catch (error) {
			if (error instanceof NotServed) {
				return "not served";
			}
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "missing";
		}
	};
	const runDetail = (runId: string): RunDetail | null => {
		const run = runs().find((run) => run.id === runId);
		const { row } = statusRowOf(runId);
		if (run === undefined || row === undefined) {
			return null;
		}
		const workflow = graphs.get(runId)?.name;
		const lastEvent = lastEvents.get(runId);
		return {
			...run,
			...(workflow === undefined ? {} : { workflow }),
			...(lastEvent === undefined ? {} : { lastEvent }),
			...(resumableRunStatusKinds.some((kind) => kind === run.statusKind)
				? { resumable: true }
				: {}),
		};
	};
	const readingWorkflows = new Set<string>();
	const readWorkflow = async (runId: string): Promise<boolean> => {
		const { row } = statusRowOf(runId);
		if (
			row === undefined ||
			graphs.get(runId)?.name !== undefined ||
			readingWorkflows.has(runId)
		) {
			return false;
		}
		readingWorkflows.add(runId);
		try {
			const graph = await graphOf(reader(fetchImpl, row.url, signal), runId);
			return graph?.name !== undefined;
		} finally {
			readingWorkflows.delete(runId);
		}
	};
	const runAgents = async (runId: string): Promise<RunAgent[] | null> => {
		const { row } = statusRowOf(runId);
		if (row === undefined) {
			return null;
		}
		if (!isLive(row.run.statusKind)) {
			return [];
		}
		const read = reader(fetchImpl, row.url, signal);
		try {
			const answer = await body(
				await read(`/runs/${encodeURIComponent(runId)}/workers`),
				workers,
			);
			const stage = stages.get(runId);
			return Object.entries(answer.workers)
				.filter(([path, worker]) => worker.turn === "running" || path === stage)
				.map(([path, worker]) => ({
					stage: path,
					tool: worker.current_tool === "" ? null : worker.current_tool,
					lastMessage: worker.last_message === "" ? null : worker.last_message,
					turn: worker.turn,
				}));
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return [];
		}
	};
	return {
		checkpoint: runCheckpoint,
		run: runDetail,
		readWorkflow,
		agents: runAgents,
	};
}
