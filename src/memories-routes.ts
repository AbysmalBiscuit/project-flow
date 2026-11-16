import type { FactoryRun } from "./domain.ts";
import type { HistoryAnswer } from "./factory-run-history.ts";
import {
	historyAnswer,
	type MemoriesPage,
	type MemoryHistory,
	type MemoryRepo,
	type MemoryReview,
	memoryRow,
	memoryVote,
} from "./memories-page.ts";
import type { FactoryReader } from "./ports.ts";
import { routeTable } from "./route-table.ts";

export type MemoriesRouteOptions = {
	factories: Pick<FactoryReader, "runs" | "memories" | "memory" | "vote">;
};

/** The routes of the Memories tab: the memories of each repo, and the history and votes of one memory. */
export function memoriesRoutes(options: MemoriesRouteOptions) {
	return routeTable({
		"/api/memories": {
			GET: async () => {
				const sources = repoSources(options.factories.runs());
				const repos = await Promise.all(
					sources.map(async ({ repo, factory }) =>
						memoryRepo(repo, factory, await options.factories.memories(repo)),
					),
				);
				return Response.json({ repos } satisfies MemoriesPage);
			},
		},
		"/api/memories/:owner/:name/:id": {
			GET: async (request) => {
				const { owner, name, id } = request.params;
				const repo = `${owner}/${name}`;
				return historyResponse(repo, await options.factories.memory(repo, id));
			},
		},
		"/api/memories/:owner/:name/:id/votes": {
			POST: async (request) => {
				const parsed = memoryVote.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json({ error: "invalid vote" }, { status: 400 });
				}
				const { owner, name, id } = request.params;
				const repo = `${owner}/${name}`;
				return historyResponse(
					repo,
					await options.factories.vote(repo, id, parsed.data),
				);
			},
		},
	});
}

/** The distinct repos of the runs, each with the factory of its first run. */
function repoSources(runs: FactoryRun[]): { repo: string; factory: string }[] {
	const factoryOf = new Map<string, string>();
	for (const run of runs) {
		if (run.repo !== undefined && !factoryOf.has(run.repo)) {
			factoryOf.set(run.repo, run.factory);
		}
	}
	return [...factoryOf].map(([repo, factory]) => ({ repo, factory }));
}

function memoryRepo(
	repo: string,
	factory: string,
	review: HistoryAnswer<MemoryReview>,
): MemoryRepo {
	if (review === null) {
		return {
			repo,
			factory,
			conflicting: [],
			recent: [],
			notServed: false,
			unreachable: true,
		};
	}
	if (review === "not served") {
		return {
			repo,
			factory,
			conflicting: [],
			recent: [],
			notServed: true,
			unreachable: false,
		};
	}
	return {
		repo,
		factory,
		conflicting: review.conflicting.map((memory) =>
			memoryRow(memory, review.evidence),
		),
		recent: review.recent.map((memory) => memoryRow(memory, review.evidence)),
		notServed: false,
		unreachable: false,
	};
}

function historyResponse(
	repo: string,
	history: HistoryAnswer<MemoryHistory>,
): Response {
	if (history === "not served") {
		return Response.json(historyAnswer(repo, null, true));
	}
	if (history === null) {
		return Response.json(historyAnswer(repo, null, false), { status: 502 });
	}
	return Response.json(historyAnswer(repo, history, false));
}
