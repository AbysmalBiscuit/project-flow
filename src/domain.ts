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

export type TicketState =
	| "done"
	| "dropped"
	| "blocked"
	| "backlog"
	| "inProgress";

export type TicketRef = {
	tracker: "github" | "linear";
	project: string;
	key: string;
	state?: "open" | "closed";
};

export type Comment = {
	body: string;
};

export type Ticket = {
	id: string;
	tracker: "github" | "linear";
	key: string | null;
	title: string;
	state: "open" | "closed";
	stateReason: string | null;
	updatedAt: string;
	ref?: string;
	body: string;
	blockedBy: TicketRef[];
	comments?: Comment[];
};

export type TicketView = {
	key: string | null;
	title: string;
	state: TicketState;
	blockers: string[];
};

export type CrossProjectBlocker = {
	project: string;
	tracker: "github" | "linear";
	key: string;
	title: string;
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
	blocked: number;
	backlog: number;
	inProgress: number;
	unlinkedPrs: UnlinkedPr[];
	tickets: TicketView[];
	crossProjectBlockers: CrossProjectBlocker[];
	needsYou: number;
	progress: number;
};

export type Overview = {
	projects: ProjectCounts[];
	fetchedAt: string | null;
	error: string | null;
};

export type FetchStatus = {
	fetchedAt: string | null;
	error: string | null;
};

export function staleView(
	status: FetchStatus,
	goodPollAt: string | null,
): FetchStatus {
	if (status.error === null) {
		return { fetchedAt: status.fetchedAt, error: null };
	}
	if (goodPollAt === null) {
		return { fetchedAt: status.fetchedAt, error: status.error };
	}
	return {
		fetchedAt: goodPollAt,
		error: `${status.error} (stale since ${goodPollAt})`,
	};
}

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

export function mergeTickets(stored: Ticket[], incoming: Ticket[]): Ticket[] {
	const byId = new Map(stored.map((ticket) => [ticket.id, ticket]));
	for (const ticket of incoming) {
		byId.set(ticket.id, ticket);
	}
	return [...byId.values()];
}

const closedReasons = new Set(["not_planned", "duplicate", "canceled"]);

export function ticketState(
	ticket: Ticket,
	blockers: TicketRef[],
): TicketState {
	if (ticket.state === "closed") {
		return closedReasons.has(ticket.stateReason ?? "") ? "dropped" : "done";
	}
	if (blockers.length > 0) {
		return "blocked";
	}
	return "backlog";
}

const label =
	/^(?:[-*+]|\d+[.)])?\s*(?:\*\*|__)?\s*(blocked by|blocks|blocking)\b\s*:?\s*(?:\*\*|__)?\s*(.*)$/i;

const anchoredRef =
	/^(?:https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)|https?:\/\/linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]+-\d+)(?:\/[^\s)]*)?|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)|#(\d+)|([A-Za-z][A-Za-z0-9]+-\d+))$/i;

function trimPunctuation(token: string): string {
	return token.replace(/^[([{"']+/, "").replace(/[)\]}"'.,;:!?]+$/, "");
}

function refFrom(match: RegExpExecArray, project: string): TicketRef | null {
	const githubUrlOwner = match[1];
	const githubUrlRepo = match[2];
	const githubUrlNumber = match[3];
	if (
		githubUrlOwner !== undefined &&
		githubUrlRepo !== undefined &&
		githubUrlNumber !== undefined
	) {
		const repo = `${githubUrlOwner}/${githubUrlRepo}`;
		return {
			tracker: "github",
			project: repo,
			key: `${repo}#${githubUrlNumber}`,
		};
	}
	const linearUrlKey = match[4];
	if (linearUrlKey !== undefined) {
		return { tracker: "linear", project: "", key: linearUrlKey.toUpperCase() };
	}
	const ownerRepo = match[5];
	const ownerNumber = match[6];
	if (ownerRepo !== undefined && ownerNumber !== undefined) {
		return {
			tracker: "github",
			project: ownerRepo,
			key: `${ownerRepo}#${ownerNumber}`,
		};
	}
	const sameNumber = match[7];
	if (sameNumber !== undefined) {
		if (!project.includes("/")) {
			return null;
		}
		return { tracker: "github", project, key: `${project}#${sameNumber}` };
	}
	const linearKey = match[8];
	if (linearKey !== undefined) {
		return { tracker: "linear", project: "", key: linearKey.toUpperCase() };
	}
	return null;
}

function sameRef(left: TicketRef, right: TicketRef): boolean {
	return (
		left.tracker === right.tracker &&
		left.key.toLowerCase() === right.key.toLowerCase()
	);
}

function parseLine(
	line: string,
	project: string,
	direction: "blockedBy" | "blocks",
): TicketRef[] {
	const matched = line.trim().match(label);
	if (matched?.[1] === undefined || matched[2] === undefined) {
		return [];
	}
	const verb = matched[1].toLowerCase();
	if (
		(direction === "blockedBy" && verb !== "blocked by") ||
		(direction === "blocks" && verb === "blocked by")
	) {
		return [];
	}
	const refs: TicketRef[] = [];
	for (const raw of matched[2].split(",")) {
		const token = trimPunctuation(raw.trim());
		if (token === "" || token.toLowerCase() === "none") {
			continue;
		}
		const found = anchoredRef.exec(token);
		if (found === null) {
			continue;
		}
		const ref = refFrom(found, project);
		if (ref !== null && !refs.some((item) => sameRef(item, ref))) {
			refs.push(ref);
		}
	}
	return refs;
}

export function bodyBlockers(
	ticket: Ticket,
	project: string,
	direction: "blockedBy" | "blocks",
): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const line of ticket.body.split("\n")) {
		for (const ref of parseLine(line, project, direction)) {
			if (!refs.some((item) => sameRef(item, ref))) {
				refs.push(ref);
			}
		}
	}
	return refs;
}

type TicketIndex = Map<string, Ticket>;

function indexKey(tracker: string, key: string): string {
	return `${tracker}\0${key.toLowerCase()}`;
}

function indexTickets(tickets: Ticket[]): TicketIndex {
	const index = new Map<string, Ticket>();
	for (const ticket of tickets) {
		if (ticket.key !== null) {
			index.set(indexKey(ticket.tracker, ticket.key), ticket);
		}
	}
	return index;
}

function known(index: TicketIndex, ref: TicketRef): Ticket | undefined {
	return index.get(indexKey(ref.tracker, ref.key));
}

function stillOpen(ref: TicketRef, index: TicketIndex): boolean {
	const ticket = known(index, ref);
	if (ticket !== undefined) {
		return ticket.state === "open";
	}
	return ref.state === "open";
}

function asRef(ticket: Ticket): TicketRef | null {
	if (ticket.key === null) {
		return null;
	}
	return { tracker: ticket.tracker, project: "", key: ticket.key };
}

type ParsedBodies = Map<
	string,
	{ blockedBy: TicketRef[]; blocks: TicketRef[] }
>;

function parseKey(ticket: Ticket): string {
	return indexKey(ticket.tracker, ticket.key ?? "");
}

function parseBodies(
	groups: { project: string; tickets: Ticket[] }[],
): ParsedBodies {
	const parsed: ParsedBodies = new Map();
	for (const group of groups) {
		for (const ticket of group.tickets) {
			parsed.set(parseKey(ticket), {
				blockedBy: bodyBlockers(ticket, group.project, "blockedBy"),
				blocks: bodyBlockers(ticket, group.project, "blocks"),
			});
		}
	}
	return parsed;
}

export function openBlockers(
	ticket: Ticket,
	index: TicketIndex,
	parsed: ParsedBodies,
): Ticket[] {
	const self = asRef(ticket);
	const incoming = ticket.blockedBy.filter((ref) => stillOpen(ref, index));
	const fromBody = (parsed.get(parseKey(ticket))?.blockedBy ?? []).filter(
		(ref) => stillOpen(ref, index),
	);
	const fromBlocks: TicketRef[] = [];
	for (const [otherKey, lines] of parsed) {
		const other = index.get(otherKey);
		if (other === undefined || other.state !== "open" || self === null) {
			continue;
		}
		if (!lines.blocks.some((ref) => sameRef(ref, self))) {
			continue;
		}
		const ref = asRef(other);
		if (ref !== null) {
			fromBlocks.push(ref);
		}
	}
	const refs = [...incoming, ...fromBody, ...fromBlocks];
	const resolved = refs.flatMap((ref) => {
		const blocker = known(index, ref);
		return blocker === undefined ? [] : [blocker];
	});
	return resolved.filter((blocker, position) => {
		if (
			self !== null &&
			blocker.key !== null &&
			sameRef(self, { tracker: blocker.tracker, project: "", key: blocker.key })
		) {
			return false;
		}
		return (
			resolved.findIndex(
				(item) =>
					item.tracker === blocker.tracker &&
					item.key?.toLowerCase() === blocker.key?.toLowerCase(),
			) === position
		);
	});
}

export function showsProject(input: {
	pinned: boolean;
	hidden: boolean;
	openTickets: number;
	updatedAt: string | null;
	now: Date;
	activityWindowDays: number;
}): boolean {
	if (input.hidden) {
		return false;
	}
	if (input.pinned) {
		return true;
	}
	if (input.openTickets === 0 || input.updatedAt === null) {
		return false;
	}
	const updated = Date.parse(input.updatedAt);
	const windowMs = input.activityWindowDays * 24 * 60 * 60 * 1000;
	return updated >= input.now.getTime() - windowMs;
}

export type ListedProject = {
	key: string;
	name?: string;
	tracker: "github" | "linear";
	updatedAt: string | null;
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
	pinned: boolean;
	hidden: boolean;
	closed?: boolean;
};

export function projectSnapshots(
	found: ListedProject[],
	now: Date,
	activityWindowDays: number,
): {
	key: string;
	name: string;
	tracker: ListedProject["tracker"];
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
}[] {
	const projects = [
		...found.filter(
			(project) => project.tracker === "github" && !project.key.includes("/"),
		),
		...found.filter(
			(project) => project.tracker === "linear" || project.key.includes("/"),
		),
	];
	const shown = projects.filter((project) => {
		const openTickets = project.tickets.filter(
			(ticket) => ticket.state === "open",
		).length;
		const ticketUpdated = project.tickets.reduce<string | null>(
			(latest, ticket) => {
				if (ticket.updatedAt === undefined) {
					return latest;
				}
				return latest === null || ticket.updatedAt > latest
					? ticket.updatedAt
					: latest;
			},
			null,
		);
		const updatedAt =
			project.updatedAt === null
				? ticketUpdated
				: ticketUpdated === null || project.updatedAt > ticketUpdated
					? project.updatedAt
					: ticketUpdated;
		return (
			project.closed !== true &&
			showsProject({
				pinned: project.pinned,
				hidden: project.hidden,
				openTickets,
				updatedAt,
				now,
				activityWindowDays,
			})
		);
	});
	const claimed = new Set<string>();
	const rows = [];
	for (const project of shown) {
		const tickets = project.tickets.filter((ticket) => {
			if (ticket.ref === undefined || claimed.has(ticket.ref)) {
				return ticket.ref === undefined;
			}
			claimed.add(ticket.ref);
			return true;
		});
		rows.push({
			key: project.key,
			name: project.name ?? project.key,
			tracker: project.tracker,
			tickets,
			pulls: project.pulls,
			branches: project.branches,
			startedKeys: project.startedKeys,
		});
	}
	return rows;
}

function ticketNumber(key: string): string | null {
	const number = key.split("#").at(-1);
	if (number === undefined || !/^\d+$/.test(number)) {
		return null;
	}
	return number;
}

export const ownerRepo = /^[^/\s]+\/[^/\s]+$/;
const githubNode = /^(\d+)-/;
const sessionSuffix = /\.[a-z][a-z0-9]*-\d+$/i;
const linearKey = /^([a-z][a-z0-9]*)-(\d+)(?![a-z0-9])/i;

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
			const match = segment.match(linearKey);
			const team = match?.[1];
			const number = match?.[2];
			if (team === undefined || number === undefined) {
				continue;
			}
			const key = `${team.toUpperCase()}-${number}`;
			if (!keys.includes(key)) {
				keys.push(key);
			}
		}
	}
	return keys;
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
		const scoped = key.startsWith("#") ? `${repo ?? project}${key}` : key;
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

function blockerProject(
	blocker: Ticket,
	ref: TicketRef | undefined,
	groups: { project: string; tickets: Ticket[] }[],
): string {
	const home = groups.find((group) => group.tickets.includes(blocker))?.project;
	if (home !== undefined) {
		return home;
	}
	if (ref?.project !== undefined && ref.project !== "") {
		return ref.project;
	}
	if (blocker.tracker === "github" && blocker.key?.includes("#") === true) {
		return blocker.key.split("#")[0] ?? "";
	}
	return "";
}

export function projectCounts(
	name: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
	pulls: PullRequest[] = [],
	branches: string[] = [],
	startedKeys: string[] = [],
	all: { project: string; tickets: Ticket[] }[] = [{ project: name, tickets }],
): ProjectCounts {
	const index = indexTickets(all.flatMap((group) => group.tickets));
	const parsed = parseBodies(all);
	const counts = { done: 0, dropped: 0, blocked: 0, backlog: 0, inProgress: 0 };
	const views: TicketView[] = [];
	const cross = new Map<string, CrossProjectBlocker>();
	for (const ticket of tickets) {
		const blockers = openBlockers(ticket, index, parsed);
		const state = ticketState(
			ticket,
			blockers.flatMap((blocker) => {
				const ref = asRef(blocker);
				return ref === null ? [] : [ref];
			}),
		);
		const links = ticket.state === "open" ? linked(ticket, pulls, name) : [];
		const key = ticket.key;
		const started =
			key !== null &&
			startedKeys.some((item) => item.toLowerCase() === key.toLowerCase());
		const pushed =
			key !== null && branches.some((branch) => branchLinksTicket(branch, key));
		const moving = links.some((pull) => pull.draft) || pushed || started;
		const shown: TicketState =
			state === "backlog" && moving ? "inProgress" : state;
		counts[shown] += 1;
		views.push({
			key: ticket.key,
			title: ticket.title,
			state: shown,
			blockers: blockers.flatMap((blocker) =>
				blocker.key === null ? [] : [blocker.key],
			),
		});
		if (shown !== "blocked") {
			continue;
		}
		for (const blocker of blockers) {
			if (blocker.key === null) {
				continue;
			}
			const source = [
				...ticket.blockedBy,
				...(parsed.get(parseKey(ticket))?.blockedBy ?? []),
			].find(
				(ref) =>
					ref.tracker === blocker.tracker &&
					ref.key.toLowerCase() === blocker.key?.toLowerCase(),
			);
			const project = blockerProject(blocker, source, all);
			if (project === "" || project.toLowerCase() === name.toLowerCase()) {
				continue;
			}
			cross.set(`${blocker.tracker} ${project} ${blocker.key}`, {
				project,
				tracker: blocker.tracker,
				key: blocker.key,
				title: blocker.title,
			});
		}
	}
	const linkedNumbers = new Set(
		tickets.flatMap((ticket) =>
			linked(ticket, pulls, name).map((pull) => pull.number),
		),
	);
	const unlinkedPrs = pulls
		.filter((pull) => !linkedNumbers.has(pull.number))
		.map((pull) => ({
			number: pull.number,
			title: pull.title,
			url: pull.url,
		}));
	const needsYou = tickets.filter((ticket) =>
		needsYouTicket(ticket, tracker),
	).length;
	return {
		name,
		tracker,
		...counts,
		unlinkedPrs,
		tickets: views,
		crossProjectBlockers: [...cross.values()],
		needsYou,
		progress: progressRatio(counts),
	};
}

const stateKeys = [
	"done",
	"dropped",
	"blocked",
	"backlog",
	"inProgress",
] as const;

function progressRatio(
	counts: Pick<ProjectCounts, (typeof stateKeys)[number]>,
): number {
	const total = stateKeys.reduce((sum, state) => sum + counts[state], 0);
	if (total === 0) {
		return 0;
	}
	return Math.round((counts.done / total) * 100);
}

const askMarker = /<!--\s*workcell:ask\s+([A-Za-z0-9_.-]+)\s*-->/i;
const answerPrefix = /^(?:senior|answer)\b/i;
const nameCue =
	/\b(?:waits on|held for|left for|decision|verify|restore|passphrase|signing key)\b/i;

function askId(body: string): string | null {
	return body.match(askMarker)?.[1] ?? null;
}

function quotesAsk(body: string, id: string): boolean {
	const pattern = new RegExp(
		`(?<![A-Za-z0-9_.-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_.-])`,
		"i",
	);
	return pattern.test(body);
}

function needsYouTicket(
	ticket: Ticket,
	tracker: ProjectCounts["tracker"],
): boolean {
	if (ticket.state !== "open") {
		return false;
	}
	const comments = ticket.comments ?? [];
	const latest = new Map<string, number>();
	comments.forEach((comment, index) => {
		const id = askId(comment.body);
		if (id !== null) {
			latest.set(id, index);
		}
	});
	for (const [id, index] of latest) {
		const comment = comments[index];
		if (comment === undefined || !addressedToLev(comment.body, tracker)) {
			continue;
		}
		const later = comments.slice(index + 1);
		const answered = later.some(
			(item) => quotesAsk(item.body, id) || answerPrefix.test(item.body.trim()),
		);
		if (!answered) {
			return true;
		}
	}
	return false;
}

function addressedToLev(
	body: string,
	tracker: ProjectCounts["tracker"],
): boolean {
	const namesLev = /\blev\b/i.test(body);
	if (opensForSenior(body) && !namesLev) {
		return false;
	}
	if (tracker === "linear") {
		return true;
	}
	if (!namesLev) {
		return false;
	}
	const cueAt = body.search(nameCue);
	const nameAt = body.search(/\blev\b/i);
	if (cueAt < 0 || nameAt < 0) {
		return false;
	}
	return Math.abs(cueAt - nameAt) <= 80;
}

function opensForSenior(body: string): boolean {
	const opening = body.trim().slice(0, 240).toLowerCase();
	return /\b(?:senior|for the senior)\b/.test(opening);
}
