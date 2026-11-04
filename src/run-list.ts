import type { FactoryRun, PullRequest, RunResult, Ticket } from "./domain.ts";
import { endedRunStatusKinds } from "./kinds.ts";
import { foldKey, numberedKey } from "./ticket-key.ts";

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
	| "archivedAt"
	| "workflowPackage"
	| "failureReason"
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

type TicketOwner = { key: string; title: string; project: string };

/**
 * Finds the tracked ticket of a run: the first project, then the first ticket in it, whose
 * key matches the run key or its numbered key. One map per list keeps the lookup linear.
 */
function ticketOwners(projects: ProjectTickets[]) {
	const owners = new Map<string, TicketOwner & { order: number }>();
	let order = 0;
	for (const project of projects) {
		for (const ticket of project.tickets) {
			order += 1;
			if (ticket.key === null) {
				continue;
			}
			const folded = foldKey(ticket.key);
			if (!owners.has(folded)) {
				owners.set(folded, {
					key: ticket.key,
					title: ticket.title,
					project: project.name,
					order,
				});
			}
		}
	}
	return (run: FactoryRun): TicketOwner | undefined => {
		const keys = [run.key];
		if (run.repo !== undefined) {
			keys.push(numberedKey(run.repo, run.key));
		}
		const [first] = keys
			.flatMap((key) => owners.get(foldKey(key)) ?? [])
			.sort((left, right) => left.order - right.order);
		return first;
	};
}

/** Each factory run, in the order of `runs`, with its ticket from the tracked projects. */
export function runList(
	runs: FactoryRun[],
	projects: ProjectTickets[],
): RunListRow[] {
	const pulls = projects.flatMap((project) => project.pulls);
	const ownerOf = ticketOwners(projects);
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
			...(run.archivedAt === undefined ? {} : { archivedAt: run.archivedAt }),
			...(run.workflowPackage === undefined
				? {}
				: { workflowPackage: run.workflowPackage }),
			...(run.failureReason === undefined
				? {}
				: { failureReason: run.failureReason }),
			...(pull === undefined
				? {}
				: { pull: { number: pull.number, url: pull.url } }),
			...(result === undefined ? {} : { result }),
		};
		const owner = ownerOf(run);
		if (owner !== undefined) {
			return {
				...row,
				key: owner.key,
				title: owner.title,
				project: owner.project,
			};
		}
		return {
			...row,
			key: run.repo === undefined ? run.key : numberedKey(run.repo, run.key),
			...(run.repo === undefined ? {} : { project: run.repo }),
		};
	});
}
