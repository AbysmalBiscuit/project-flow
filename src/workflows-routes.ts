import type { FactoryReader } from "./ports.ts";
import { routeTable } from "./route-table.ts";
import type { PackageRun, RunHistory } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";
import {
	versionRuns,
	type WorkflowDetail,
	workflowDetail,
	workflowsPage,
} from "./workflows-page.ts";

/** The latest runs that the graph read tries, so that a run its factory dropped does not hide the graph. */
const graphTries = 3;

export type WorkflowsRouteOptions = {
	factories: Pick<FactoryReader, "workflowGraph">;
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
		const graph = await factories.workflowGraph(run.id);
		if (graph !== null) {
			return { runId: run.id, graph };
		}
	}
	return null;
}

/** The routes of the Workflows tab: a card for each package version, and the detail of one version. */
export function workflowsRoutes(options: WorkflowsRouteOptions) {
	return routeTable({
		"/api/workflows": {
			GET: () => {
				options.recordRuns();
				return Response.json(workflowsPage(options.history.packageRuns()));
			},
		},
		"/api/workflows/:package": {
			GET: async (request) => {
				options.recordRuns();
				const name = request.params.package;
				const sha = new URL(request.url).searchParams.get("sha");
				const runs = versionRuns(options.history.packageRuns(), name, sha);
				const ids = runs.map((run) => run.id);
				return Response.json(
					workflowDetail({
						name,
						sha,
						runs,
						visits: options.history.stageVisits(ids),
						usage: options.history.stageUsage(ids),
						rows: options.runList(),
						graph: await latestGraph(options.factories, runs),
					}),
				);
			},
		},
	});
}
