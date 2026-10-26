import type { FactoryRun, PullRequest, Ticket } from "./domain.ts";
import { linked } from "./links.ts";
import { githubKey } from "./ticket-key.ts";
import { runsFor } from "./workcell.ts";

/** One row of the Runs list: a factory run with the ticket, project and PR that it works on. */
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
> & {
	key: string;
	/** Absent when no tracked project holds the ticket. */
	title?: string;
	project?: string;
	pull?: Pick<PullRequest, "number" | "url">;
};

type ProjectTickets = {
	name: string;
	tickets: Ticket[];
	pulls: PullRequest[];
};

/** The newest PR that links to the ticket. */
function newestPull(ticket: Ticket, pulls: PullRequest[]) {
	return linked(ticket, pulls).toSorted(
		(left, right) => right.number - left.number,
	)[0];
}

/** Each factory run, in the order of `runs`, with its ticket from the tracked projects. */
export function runList(
	runs: FactoryRun[],
	projects: ProjectTickets[],
): RunListRow[] {
	return runs.map((run) => {
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
		};
		for (const project of projects) {
			const ticket = project.tickets.find(
				(item) => runsFor(item, [run]).length > 0,
			);
			if (ticket?.key === undefined || ticket.key === null) {
				continue;
			}
			const pull = newestPull(ticket, project.pulls);
			return {
				...row,
				key: ticket.key,
				title: ticket.title,
				project: project.name,
				...(pull === undefined
					? {}
					: { pull: { number: pull.number, url: pull.url } }),
			};
		}
		return {
			...row,
			key: run.repo === undefined ? run.key : githubKey(run.repo, run.key),
			...(run.repo === undefined ? {} : { project: run.repo }),
		};
	});
}
