import { bodyBlockers, bodyLines, bodyRepo } from "./blockers.ts";
import type { ListedProject, Snapshot, Ticket, TrackerKind } from "./domain.ts";
import type { FoundProject, LocalCheckout, Viewer } from "./ports.ts";
import { listedRef, ownerRepo, refRepo } from "./project-ref.ts";
import { mergeBlockedBy } from "./ticket-index.ts";
import { sameTicketKey, scopedKey, teamKey } from "./ticket-key.ts";

export function todoRows(listing: string): { project: string }[] {
	const projects: { project: string }[] = [];
	const seen = new Set<string>();
	for (const line of listing.split("\n")) {
		const heading = line.match(/^## (.+)$/)?.[1]?.trim() ?? "";
		const project = heading.split(".")[0]?.trim() ?? "";
		if (project === "" || seen.has(heading)) {
			continue;
		}
		seen.add(heading);
		projects.push({ project: heading });
	}
	return projects;
}

export function projectSnapshots(found: ListedProject[]): Snapshot[] {
	const kinds = new Map(
		found.map((project) => [project, listedRef(project).kind]),
	);
	const projects = [
		...found.filter((project) => kinds.get(project) === "github-project"),
		...found.filter((project) => kinds.get(project) !== "github-project"),
	];
	const shown = projects.filter((project) => project.closed !== true);
	const carried = new Map<string, Ticket>();
	for (const project of shown) {
		if (kinds.get(project) !== "github-repo") {
			continue;
		}
		for (const ticket of project.tickets) {
			if (ticket.ref !== undefined) {
				carried.set(ticket.ref, ticket);
			}
		}
	}
	const rows = [];
	for (const project of shown) {
		const repo = refRepo(listedRef(project));
		const tickets = project.tickets.map((ticket) => {
			const donor =
				ticket.ref === undefined ? undefined : carried.get(ticket.ref);
			const outgoing = bodyLines(donor, ticket);
			return donor === undefined || donor === ticket
				? ticket
				: {
						...ticket,
						body:
							ticket.body.trim() === ""
								? donor.body
								: `${ticket.body}\n${outgoing}`,
						blockedBy: mergeBlockedBy([
							donor.blockedBy,
							ticket.blockedBy,
							bodyBlockers(donor, bodyRepo(donor, repo), "blockedBy"),
							bodyBlockers(ticket, bodyRepo(ticket, repo), "blockedBy"),
						]),
					};
		});
		rows.push({
			key: project.key,
			name: project.name ?? project.key,
			tracker: project.tracker,
			tickets,
			pulls: project.pulls,
			branches: project.branches,
			startedKeys: project.startedKeys,
			...(project.board === undefined ? {} : { board: project.board }),
			...(project.host === undefined ? {} : { host: project.host }),
			...(project.owner === undefined ? {} : { owner: project.owner }),
			...(project.number === undefined ? {} : { number: project.number }),
		});
	}
	return claimTickets(rows);
}

/**
 * A ticket shows in one project only. A copy in `fresh` beats a stored copy,
 * so a failed poll cannot hide the state that another project just read.
 * Then a GitHub project row beats the other rows, and then the first row wins.
 */
export function claimTickets(
	rows: Snapshot[],
	fresh: ReadonlySet<Ticket> = new Set(),
): Snapshot[] {
	const rank = (row: Snapshot, ticket: Ticket) =>
		(fresh.has(ticket) ? 0 : 2) +
		(listedRef(row).kind === "github-project" ? 0 : 1);
	const owners = new Map<
		string,
		{ row: Snapshot; ticket: Ticket; rank: number }
	>();
	for (const row of rows) {
		for (const ticket of row.tickets) {
			if (ticket.ref === undefined) {
				continue;
			}
			const owner = owners.get(ticket.ref);
			const candidate = rank(row, ticket);
			if (owner === undefined || candidate < owner.rank) {
				owners.set(ticket.ref, { row, ticket, rank: candidate });
			}
		}
	}
	return rows.map((row) => {
		const tickets = row.tickets.filter((ticket) => {
			if (ticket.ref === undefined) {
				return true;
			}
			const owner = owners.get(ticket.ref);
			return owner?.row === row && owner.ticket === ticket;
		});
		return tickets.length === row.tickets.length ? row : { ...row, tickets };
	});
}

const githubNode = /^(\d+)-/;

const sessionSuffix = /\.[a-z][a-z0-9]*-\d+$/i;

const linearSegment = /^([a-z][a-z0-9]*)-(\d+)(?![a-z0-9])/i;

export function checkoutNamesProject(
	hasTrackerConfig: boolean,
	originOwner: string | null,
	viewer: { login: string; orgs: string[] } | null,
): boolean {
	if (hasTrackerConfig) {
		return true;
	}
	if (viewer === null || originOwner === null || originOwner.trim() === "") {
		return false;
	}
	const owner = originOwner.trim().toLowerCase();
	return [viewer.login, ...viewer.orgs].some(
		(name) => name.trim().toLowerCase() === owner,
	);
}

export function githubRepoForTodo(
	project: string,
	checkouts: { name: string; repo: string }[],
): string | null {
	const dot = project.indexOf(".");
	const name = (dot <= 0 ? project : project.slice(0, dot)).trim();
	if (name === "") {
		return null;
	}
	const node = dot <= 0 ? "" : project.slice(dot + 1);
	if (node === "main" || node.startsWith("pr-")) {
		return null;
	}
	const ticket = node.split(".")[0] ?? "";
	if (node !== "" && githubNode.test(ticket) !== true) {
		return null;
	}
	const checkout = checkouts.find((item) => item.name === name);
	if (checkout === undefined || ownerRepo.test(checkout.repo) !== true) {
		return null;
	}
	return checkout.repo;
}

export function checkoutBasenames(
	checkouts: (
		| { path: string; tracker: "github"; repo: string }
		| { path: string; tracker: "linear" }
	)[],
): { name: string; repo: string }[] {
	return checkouts.flatMap((checkout) => {
		if (checkout.tracker !== "github" || checkout.repo.trim() === "") {
			return [];
		}
		const name = checkout.path.split(/[/\\]/).at(-1) ?? "";
		if (name === "") {
			return [];
		}
		return [{ name, repo: checkout.repo.trim() }];
	});
}

export function linearNamesFromCheckouts(
	checkouts: (
		| { path: string; tracker: "github"; names: string[] }
		| { path: string; tracker: "linear"; names: string[] }
	)[],
	rows: { project: string }[],
): string[] {
	const names: string[] = [];
	for (const checkout of checkouts) {
		if (checkout.tracker !== "linear") {
			continue;
		}
		const checkoutName = checkout.path.split(/[/\\]/).at(-1) ?? "";
		names.push(...checkout.names);
		names.push(
			...rows.flatMap((row) => {
				if (!row.project.startsWith(`${checkoutName}.`)) {
					return [];
				}
				return row.project.replace(sessionSuffix, "").split(".").slice(1);
			}),
		);
	}
	return names;
}

export function linearKeysForNames(names: string[]): string[] {
	const keys: string[] = [];
	for (const name of names) {
		const bare = name.replace(sessionSuffix, "");
		for (const segment of bare.split(/[/_.]/)) {
			const match = segment.match(linearSegment);
			const team = match?.[1];
			const number = match?.[2];
			if (team === undefined || number === undefined) {
				continue;
			}
			const key = teamKey(team, number);
			if (!keys.includes(key)) {
				keys.push(key);
			}
		}
	}
	return keys;
}

/** The projects that the local checkouts name, for a viewer of their tracker. */
export function checkoutProjects(
	checkouts: LocalCheckout[],
	viewerOf: (tracker: TrackerKind) => Viewer | null,
): FoundProject[] {
	return checkouts.flatMap((checkout) => {
		if (checkout.tracker !== "github" || checkout.repo.trim() === "") {
			return [];
		}
		const named = checkoutNamesProject(
			checkout.hasTrackerConfig,
			checkout.originOwner,
			viewerOf(checkout.tracker),
		);
		return named
			? [
					{
						key: checkout.repo.trim(),
						tracker: checkout.tracker,
						updatedAt: null,
					},
				]
			: [];
	});
}

/** The projects that the todo headings name. */
export function todoProjects(
	rows: { project: string }[],
	checkouts: LocalCheckout[],
): FoundProject[] {
	const basenames = checkoutBasenames(checkouts);
	return rows.flatMap((row) => {
		const repo = githubRepoForTodo(row.project, basenames);
		return repo === null
			? []
			: [{ key: repo, tracker: "github" as const, updatedAt: null }];
	});
}

/** The ticket keys that the local checkouts and the todo headings name. */
export function namedTicketKeys(
	checkouts: LocalCheckout[],
	rows: { project: string }[],
): string[] {
	return linearKeysForNames(linearNamesFromCheckouts(checkouts, rows));
}

const startedTodo = /^- \[ \] .+ \(([^,]+), in progress(?:: [^)]+)?\)/;

export function startedTodoKeys(
	listing: string,
	repos: { name: string; repo: string }[] = [],
): string[] {
	const keys: string[] = [];
	let project = "";
	for (const line of listing.split("\n")) {
		const heading = line.match(/^## (.+)$/);
		if (heading?.[1] !== undefined) {
			project = heading[1].split(".")[0]?.trim() ?? "";
			continue;
		}
		const key = line.match(startedTodo)?.[1];
		if (key === undefined) {
			continue;
		}
		const repo = repos.find((item) => item.name === project)?.repo;
		const scoped = scopedKey(repo ?? project, key);
		if (!keys.some((item) => sameTicketKey(item, scoped))) {
			keys.push(scoped);
		}
	}
	return keys;
}
