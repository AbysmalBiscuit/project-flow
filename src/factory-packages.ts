import { z } from "zod";

import type { RunGraph } from "./domain.ts";
import { body, reader, Unreachable } from "./factory-http.ts";
import type { Fetch } from "./fetch.ts";
import {
	type CallingGraph,
	callsOf,
	inCallOrder,
	type WorkflowGraph,
} from "./workflow-dot.ts";

/** One workflow package that a factory serves, at the version it has now. */
export type FactoryPackage = {
	/** The url of the factory that lists the package. */
	url: string;
	name: string;
	/** The repo of a repo package. Null for a package that workcell ships. */
	repo: string | null;
	/** The sha256 of the package, as the `workflow.started` event of a run names it. */
	version: string;
	lastRun: string | null;
};

/** What the stylesheet of a package gives a role on its factory. Null for a default. */
export type PackageRole = {
	name: string;
	harness: string | null;
	model: string | null;
};

/** Each graph of a package, the entry graph first, and its roles. */
export type PackageDetail = { graphs: WorkflowGraph[]; roles: PackageRole[] };

/** `GET /packages`: the workflow packages of the daemon, also a package with no run. */
const packageList = z.object({
	packages: z.array(
		z.object({
			name: z.string(),
			repo: z.string().nullable(),
			version: z.string(),
			last_run: z.string().nullable(),
		}),
	),
});

const attrs = z.record(z.string(), z.unknown()).default({});

/** The `GraphView` of `GET /runs/{id}/graph`, as `GET /packages/{name}` gives each graph. */
const graphView = z.object({
	nodes: z.array(
		z.object({
			id: z.string(),
			attrs,
			classes: z.array(z.string()).default([]),
			handler: z.string().optional(),
		}),
	),
	edges: z.array(z.object({ from: z.string(), to: z.string(), attrs })),
});

/** `GET /packages/{name}?repo=`: each graph by its path in the package, and the roles. */
const packageDetail = z.object({
	entry: z.string().nullable(),
	graphs: z.record(z.string(), graphView),
	roles: z.array(
		z.object({
			name: z.string(),
			harness: z.string().nullable(),
			model: z.string().nullable(),
		}),
	),
});

const text = (value: unknown) =>
	typeof value === "string" ? value : undefined;

/** A graph of a package. The role of a node is the first of its classes that names a role of the package. */
function packageGraph(
	view: z.infer<typeof graphView>,
	roles: ReadonlySet<string>,
): CallingGraph {
	const graph: RunGraph = {
		nodes: view.nodes.map((node) => {
			const role = node.classes.find((name) => roles.has(name));
			return {
				id: node.id,
				label: text(node.attrs.label) ?? node.id,
				shape: text(node.attrs.shape) ?? "box",
				kind: node.handler ?? "codergen",
				...(role === undefined ? {} : { role }),
				state: "ahead",
				visits: 0,
				retries: 0,
			};
		}),
		edges: view.edges.map((edge) => {
			const label = text(edge.attrs.label);
			const condition = text(edge.attrs.condition);
			return {
				from: edge.from,
				to: edge.to,
				...(label === undefined ? {} : { label }),
				...(condition === undefined ? {} : { condition }),
			};
		}),
	};
	return { graph, calls: view.nodes.flatMap((node) => callsOf(node.attrs)) };
}

/** The package reads of the reachable factories. */
export function factoryPackagesReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	/** The url of each listed factory whose last check found it. */
	reachable: () => string[];
}) {
	const { fetchImpl, signal, reachable } = deps;
	return {
		/**
		 * `GET /packages` of each reachable factory, one entry for each package version.
		 * "not served" when no factory answers the read.
		 */
		packages: async (): Promise<FactoryPackage[] | "not served"> => {
			const lists = await Promise.all(
				reachable().map(async (url) => {
					try {
						const answer = await body(
							await reader(fetchImpl, url, signal)("/packages"),
							packageList,
						);
						return answer.packages.map((item): FactoryPackage => ({
							url,
							name: item.name,
							repo: item.repo,
							version: item.version,
							lastRun: item.last_run,
						}));
					} catch (error) {
						if (!(error instanceof Unreachable)) {
							throw error;
						}
						return null;
					}
				}),
			);
			const served = lists.filter((list) => list !== null);
			if (served.length === 0) {
				return "not served";
			}
			const versions = new Map<string, FactoryPackage>();
			for (const item of served.flat()) {
				const key = JSON.stringify([item.name, item.version]);
				if (!versions.has(key)) {
					versions.set(key, item);
				}
			}
			return [...versions.values()];
		},
		/**
		 * `GET /packages/{name}?repo=` of the factory that lists the package: the entry graph,
		 * each graph that it calls, then the other graphs. Null when the read fails.
		 */
		packageDetail: async (
			listed: FactoryPackage,
		): Promise<PackageDetail | null> => {
			const query =
				listed.repo === null ? "" : `?repo=${encodeURIComponent(listed.repo)}`;
			try {
				const found = await body(
					await reader(
						fetchImpl,
						listed.url,
						signal,
					)(`/packages/${encodeURIComponent(listed.name)}${query}`),
					packageDetail,
				);
				const roles = new Set(found.roles.map((role) => role.name));
				const graphs = new Map(
					Object.entries(found.graphs).map(([name, view]) => [
						name,
						packageGraph(view, roles),
					]),
				);
				const called =
					found.entry === null
						? []
						: inCallOrder(found.entry, (name) => graphs.get(name));
				const shown = new Set(called.map((item) => item.name));
				return {
					graphs: [
						...called,
						...[...graphs]
							.filter(([name]) => !shown.has(name))
							.map(([name, { graph }]) => ({ name, graph })),
					],
					roles: found.roles,
				};
			} catch (error) {
				if (!(error instanceof Unreachable)) {
					throw error;
				}
				return null;
			}
		},
	};
}
