import type { FactoryRun, PullRequest, RunResult, Ticket } from "./domain.ts";
import { endedRunStatusKinds } from "./domain.ts";
import { githubKey } from "./ticket-key.ts";
import { runsFor } from "./workcell.ts";

/** One row of the Runs list: a factory run with the ticket, project, PR and result that it works on. */
export type RunListRow = Pick<
	FactoryRun,
	| "id"
	| "statusKind"
	| "stage"
	| "factory"
	| "box"
	| "submittedAt"
	| "startedAt"
	| "endedAt"
	| "coveredByFeed"
	| "usageTotals"
> & {
	key: string;
	/** Absent when no tracked project holds the ticket. */
	title?: string;
	project?: string;
	/** The PR that the run opened. */
	pull?: Pick<PullRequest, "number" | "url">;
	/** Absent while the run is queued or live. */
	result?: RunResult;
};

type ProjectTickets = {
	name: string;
	tickets: Ticket[];
	pulls: PullRequest[];
};

/**
 * What an ended run came to. A merged PR wins over the run status. A stored PR that
 * is not merged is open or a draft. A PR that the store lacks is closed.
 */
export function runResultOf(
	run: FactoryRun,
	pulls: PullRequest[],
): RunResult | undefined {
	if (!endedRunStatusKinds.some((kind) => kind === run.statusKind)) {
		return undefined;
	}
	const { pull } = run;
	const stored =
		pull === undefined
			? undefined
			: pulls.find(
					(item) =>
						item.number === pull.number &&
						item.repo.toLowerCase() === pull.repo.toLowerCase(),
				);
	if (stored?.merged === true || pull?.merged === true) {
		return "merged";
	}
	if (run.statusKind === "failed") {
		// The factory ends a cancelled run as failed with this reason.
		return run.failureReason === "stopped" ? "cancelled" : "failed";
	}
	return stored === undefined ? "noPr" : "prOpen";
}

/** Each factory run, in the order of `runs`, with its ticket from the tracked projects. */
export function runList(
	runs: FactoryRun[],
	projects: ProjectTickets[],
): RunListRow[] {
	const pulls = projects.flatMap((project) => project.pulls);
	return runs.map((run) => {
		const { pull } = run;
		const result = runResultOf(run, pulls);
		const row = {
			id: run.id,
			statusKind: run.statusKind,
			...(run.stage === undefined ? {} : { stage: run.stage }),
			factory: run.factory,
			box: run.box,
			submittedAt: run.submittedAt,
			startedAt: run.startedAt,
			endedAt: run.endedAt,
			coveredByFeed: run.coveredByFeed,
			...(run.usageTotals === undefined
				? {}
				: { usageTotals: run.usageTotals }),
			...(pull === undefined
				? {}
				: { pull: { number: pull.number, url: pull.url } }),
			...(result === undefined ? {} : { result }),
		};
		for (const project of projects) {
			const ticket = project.tickets.find(
				(item) => runsFor(item, [run]).length > 0,
			);
			if (ticket?.key === undefined || ticket.key === null) {
				continue;
			}
			return {
				...row,
				key: ticket.key,
				title: ticket.title,
				project: project.name,
			};
		}
		return {
			...row,
			key: run.repo === undefined ? run.key : githubKey(run.repo, run.key),
			...(run.repo === undefined ? {} : { project: run.repo }),
		};
	});
}
