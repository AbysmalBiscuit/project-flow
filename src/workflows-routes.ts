import type { FactoryReader } from "./ports.ts";
import { routeTable } from "./route-table.ts";
import type { PackageRun, RunHistory } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";
import { sourceGraphs } from "./workflow-dot.ts";
import {
	versionRuns,
	type WorkflowDetail,
	workflowDetail,
	workflowsPage,
} from "./workflows-page.ts";

/** The latest runs that the graph read tries, so that a run its factory dropped does not hide the graph. */
const graphTries = 3;

export type WorkflowsRouteOptions = {
	factories: Pick<
		FactoryReader,
		"source" | "firstPullsRun" | "packages" | "packageDetail"
	>;
	history: RunHistory;
	runList: () => RunListRow[];
	/** Bring the run history up to date with the run list. */
	recordRuns: () => void;
};

async function latestGraph(
	factories: WorkflowsRouteOptions["factories"],
	runs: readonly PackageRun[],
): Promise<WorkflowDetail["graph"]> {
	for (const run of runs.slice(0, graphTries)) {
		const source = await factories.source(run.id);
		const graphs = typeof source === "string" ? [] : sourceGraphs(source);
		if (graphs.length > 0) {
			return { runId: run.id, graphs };
		}
	}
	return null;
}

/** The package versions that the factories list. Empty when no factory serves the list. */
async function listedPackages(factories: WorkflowsRouteOptions["factories"]) {
	const listed = await factories.packages();
	return listed === "not served" ? [] : listed;
}

/** The routes of the Workflows tab: a card for each package version, and the detail of one version. */
export function workflowsRoutes(options: WorkflowsRouteOptions) {
	return routeTable({
		"/api/workflows": {
			GET: async () => {
				options.recordRuns();
				const listed = await listedPackages(options.factories);
				return Response.json(
					workflowsPage(
						options.history.packageRuns(),
						options.factories.firstPullsRun(),
						listed,
					),
				);
			},
		},
		"/api/workflows/:package": {
			GET: async (request) => {
				options.recordRuns();
				const name = request.params.package;
				const sha = new URL(request.url).searchParams.get("sha");
				const runs = versionRuns(options.history.packageRuns(), name, sha);
				const ids = runs.map((run) => run.id);
				const named = (await listedPackages(options.factories)).filter(
					(item) => item.name === name,
				);
				const exact = named.find((item) => item.version === sha);
				// A version that no factory lists takes the roles of the package that the factory holds now.
				const version = exact ?? named[0];
				const listed =
					version === undefined
						? null
						: await options.factories.packageDetail(version);
				return Response.json(
					workflowDetail({
						name,
						sha,
						runs,
						visits: options.history.stageVisits(ids),
						usage: options.history.stageUsage(ids),
						rows: options.runList(),
						graph:
							listed !== null && exact !== undefined
								? { graphs: listed.graphs }
								: await latestGraph(options.factories, runs),
						listed:
							listed === null
								? null
								: { detail: listed, usage: options.history.modelUsage(ids) },
					}),
				);
			},
		},
	});
}
