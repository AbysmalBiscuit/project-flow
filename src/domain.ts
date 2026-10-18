export type TicketState = "done" | "dropped" | "backlog" | "inProgress";

export type Ticket = {
	tracker: "github" | "linear";
	key: string | null;
	state: "open" | "closed";
	stateReason: string | null;
};

export type PullRequest = {
	number: number;
	url: string;
	title: string;
	draft: boolean;
	branch: string;
	body: string;
	closingKeys: string[];
};

export type UnlinkedPr = {
	number: number;
	title: string;
	url: string;
};

export type ProjectCounts = {
	name: string;
	tracker: "github" | "linear";
	done: number;
	dropped: number;
	backlog: number;
	inProgress: number;
	unlinkedPrs: UnlinkedPr[];
};

export type Overview = {
	projects: ProjectCounts[];
};

const closing =
	/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)/gi;

function closingKeys(body: string, repo: string): string[] {
	const keys: string[] = [];
	for (const match of body.matchAll(closing)) {
		const number = match[2];
		if (number === undefined) {
			continue;
		}
		const key = `${match[1] ?? repo}#${number}`;
		if (!keys.includes(key)) {
			keys.push(key);
		}
	}
	return keys;
}

export function ticketState(ticket: Ticket): TicketState {
	if (ticket.state === "open") {
		return "backlog";
	}
	if (
		ticket.stateReason === "not_planned" ||
		ticket.stateReason === "duplicate"
	) {
		return "dropped";
	}
	return "done";
}

function ticketNumber(key: string): string | null {
	const number = key.split("#").at(-1);
	if (number === undefined || !/^\d+$/.test(number)) {
		return null;
	}
	return number;
}

const startedTodo = /^- \[ \] .+ \(([^,]+), in progress(?:: [^)]+)?\)/;

export function startedTodoKeys(listing: string): string[] {
	const keys: string[] = [];
	let project = "";
	for (const line of listing.split("\n")) {
		const heading = line.match(/^## (.+)$/);
		if (heading?.[1] !== undefined) {
			project = heading[1];
			continue;
		}
		const key = line.match(startedTodo)?.[1];
		if (key === undefined) {
			continue;
		}
		const scoped = key.startsWith("#") ? `${project}${key}` : key;
		if (!keys.some((item) => item.toLowerCase() === scoped.toLowerCase())) {
			keys.push(scoped);
		}
	}
	return keys;
}

function branchLinksTicket(branch: string, key: string): boolean {
	const number = ticketNumber(key);
	if (number !== null) {
		const leading = new RegExp(`^(?:[^/]+/)?${number}-`);
		if (leading.test(branch)) {
			return true;
		}
	}
	return key.includes("#") && branch.toLowerCase().includes(key.toLowerCase());
}

function linked(
	ticket: Ticket,
	pulls: PullRequest[],
	repo: string,
): PullRequest[] {
	if (ticket.key === null) {
		return [];
	}
	const key = ticket.key;
	return pulls.filter((pull) => {
		const keys = [...pull.closingKeys, ...closingKeys(pull.body, repo)];
		return keys.includes(key) || branchLinksTicket(pull.branch, key);
	});
}

export function projectCounts(
	name: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
	pulls: PullRequest[] = [],
	branches: string[] = [],
	startedKeys: string[] = [],
): ProjectCounts {
	const counts = { done: 0, dropped: 0, backlog: 0, inProgress: 0 };
	for (const ticket of tickets) {
		const state = ticketState(ticket);
		const links = ticket.state === "open" ? linked(ticket, pulls, name) : [];
		const key = ticket.key;
		const started =
			key !== null &&
			startedKeys.some((item) => item.toLowerCase() === key.toLowerCase());
		const pushed =
			key !== null && branches.some((branch) => branchLinksTicket(branch, key));
		const inProgress = links.some((pull) => pull.draft) || pushed || started;
		if (state === "backlog" && inProgress) {
			counts.inProgress += 1;
			continue;
		}
		counts[state] += 1;
	}
	const linkedKeys = new Set(
		tickets.flatMap((ticket) =>
			linked(ticket, pulls, name).map((pull) => pull.number),
		),
	);
	const unlinkedPrs = pulls
		.filter((pull) => !linkedKeys.has(pull.number))
		.map((pull) => ({
			number: pull.number,
			title: pull.title,
			url: pull.url,
		}));
	return { name, tracker, ...counts, unlinkedPrs };
}
