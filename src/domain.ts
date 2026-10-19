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
	| "inProgress"
	| "inReview"
	| "awaitingMerge";

export type TicketRef = {
	tracker: "github" | "linear";
	project: string;
	key: string;
	state?: "open" | "closed";
};

export type Comment = {
	body: string;
	createdAt?: string;
	author?: string;
	reactions?: number;
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
	milestone: string | null;
	parent: string | null;
	labels: string[];
	assignee?: string | null;
	assignees?: string[];
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
	repo: string;
	number: number;
	url: string;
	title: string;
	draft: boolean;
	branch: string;
	body: string;
	closingKeys: string[];
	headSha: string;
	headCommittedAt: string | null;
	merged: boolean;
	checks: BotCheck[];
	comments: BotComment[];
	reviews: BotReview[];
	reactions: BotReaction[];
};

export type BotCheck = {
	name: string;
	status: string;
	conclusion: string | null;
};

export type BotComment = {
	login: string;
	body: string;
	createdAt: string | null;
	reactions?: number;
};

export type BotReview = {
	login: string;
	commitId: string;
};

export type BotReaction = {
	login: string;
	content: string;
	createdAt: string | null;
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
	inReview: number;
	awaitingMerge: number;
	unlinkedPrs: UnlinkedPr[];
	tickets: TicketView[];
	crossProjectBlockers: CrossProjectBlocker[];
	needsYou: number;
	progress: number;
	fetchedAt: string | null;
	error: string | null;
	tags: string[];
};

export type DiagramNode = {
	id: string;
	label: string;
	state: TicketState | "external" | "theme";
	dashed: boolean;
	project: string;
	tracker: "github" | "linear";
	ticket: string | null;
};

export type DiagramEdge = {
	from: string;
	to: string;
};

export type Diagram = {
	id: string;
	title: string;
	direction: "TD" | "LR";
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	definition: string;
};

export type NeedsYouItem = {
	project: string;
	tracker: "github" | "linear";
	key: string;
	headline: string;
	reason: "ask" | "awaitingMerge" | "label";
	tags: string[];
	answered: boolean;
	acknowledged: boolean;
};

export type ReportSection = {
	id:
		| "summary"
		| "featureMap"
		| "inFlight"
		| "blockingChains"
		| "needsYou"
		| "backlog";
	title: string;
	text?: string;
	items?: TicketView[];
	needsYou?: NeedsYouItem[];
	diagrams?: Diagram[];
};

export type ProjectReport = {
	name: string;
	tracker: "github" | "linear";
	sections: ReportSection[];
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

export type Snapshot = {
	key: string;
	name: string;
	tracker: "github" | "linear";
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
};

export type ProjectPoll = {
	key: string;
	ok: boolean;
	error: string | null;
	full: boolean;
	pinned: boolean;
	hidden: boolean;
	row: Snapshot | null;
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

export type PollReconcile = {
	rows: Snapshot[];
	projectErrors: { key: string; error: string }[];
	globalError: string | null;
};

function keptPulls(
	stored: PullRequest[],
	incoming: PullRequest[],
	returnedIds: Set<string>,
	full: boolean,
): PullRequest[] {
	if (full) {
		return incoming;
	}
	const incomingKeys = new Set(incoming.flatMap((pull) => pull.closingKeys));
	return [
		...incoming,
		...stored.filter(
			(pull) =>
				!pull.closingKeys.some(
					(key) => returnedIds.has(key) || incomingKeys.has(key),
				),
		),
	];
}

export function reconcilePoll(
	previous: Snapshot[],
	outcomes: ProjectPoll[],
	fullKeys: string[],
): PollReconcile {
	const full = new Set(fullKeys);
	const rows: Snapshot[] = [];
	const projectErrors: { key: string; error: string }[] = [];
	const seen = new Set<string>();
	for (const outcome of outcomes) {
		seen.add(outcome.key);
		if (outcome.ok) {
			if (outcome.row === null) {
				continue;
			}
			const prior = previous.find((row) => row.key === outcome.key);
			const tickets = outcome.full
				? outcome.row.tickets
				: mergeTickets(prior?.tickets ?? [], outcome.row.tickets);
			const returnedIds = new Set(
				outcome.row.tickets.flatMap((ticket) =>
					ticket.key === null ? [] : [ticket.key],
				),
			);
			rows.push({
				...outcome.row,
				tickets,
				pulls: keptPulls(
					prior?.pulls ?? [],
					outcome.row.pulls,
					returnedIds,
					outcome.full,
				),
			});
			continue;
		}
		if (outcome.error !== null) {
			projectErrors.push({ key: outcome.key, error: outcome.error });
		}
		const prior = previous.find((row) => row.key === outcome.key);
		if (prior !== undefined) {
			rows.push(prior);
			continue;
		}
		if (
			outcome.row === null ||
			outcome.error === null ||
			!showsFailedProject({
				pinned: outcome.pinned,
				hidden: outcome.hidden,
				hasStoredRows: false,
			})
		) {
			continue;
		}
		rows.push(outcome.row);
	}
	for (const row of previous) {
		if (seen.has(row.key) || full.size > 0) {
			continue;
		}
		rows.push(row);
	}
	const failed = outcomes.find(
		(outcome) =>
			!outcome.ok &&
			outcome.error !== null &&
			!outcome.hidden &&
			!rows.some((row) => row.key === outcome.key),
	);
	const globalError = failed?.error ?? null;
	return { rows, projectErrors, globalError };
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

export function showsFailedProject(input: {
	pinned: boolean;
	hidden: boolean;
	hasStoredRows: boolean;
}): boolean {
	if (input.hidden || input.hasStoredRows) {
		return false;
	}
	return input.pinned;
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

export const knownBots = ["grok", "codex", "greptile"] as const;
export type KnownBot = (typeof knownBots)[number];

const botLogin: Record<KnownBot, string> = {
	grok: "grok-code-review[bot]",
	codex: "chatgpt-codex-connector[bot]",
	greptile: "greptile-apps[bot]",
};

const botCheck: Record<KnownBot, RegExp> = {
	grok: /grok/i,
	codex: /codex/i,
	greptile: /greptile/i,
};

const usageLimit = /usage limit/i;
const codexMarker = "<!-- codex-pull-request-review-summary -->";
const greptileMarker = "<!-- greptile_summary -->";
const codexRow = /^\|[^|\n]*\*\*([^*|\n]+)[^|\n]*\|([^|\n]*)\|/gm;

function expectedBotsFromHistory(pulls: PullRequest[]): KnownBot[] {
	const found = new Set<KnownBot>();
	for (const pull of pulls) {
		if (!pull.merged) {
			continue;
		}
		for (const bot of knownBots) {
			if (pullShowsBot(pull, bot)) {
				found.add(bot);
			}
		}
	}
	return knownBots.filter((bot) => found.has(bot));
}

export function expectedBotsByRepo(
	pulls: PullRequest[],
	overrides: Record<string, KnownBot[]>,
): Map<string, KnownBot[]> {
	const repos = new Set(pulls.map((pull) => pull.repo));
	const bots = new Map<string, KnownBot[]>();
	for (const repo of repos) {
		bots.set(
			repo,
			expectedBotsFromHistory(pulls.filter((pull) => pull.repo === repo)),
		);
	}
	for (const [repo, override] of Object.entries(overrides)) {
		if (bots.has(repo)) {
			bots.set(repo, override);
		}
	}
	return bots;
}

function pullShowsBot(pull: PullRequest, bot: KnownBot): boolean {
	const login = botLogin[bot];
	if (pull.checks.some((check) => botCheck[bot].test(check.name))) {
		return true;
	}
	if (pull.comments.some((comment) => comment.login === login)) {
		return true;
	}
	if (pull.reviews.some((review) => review.login === login)) {
		return true;
	}
	return pull.reactions.some((reaction) => reaction.login === login);
}

type BotPass = { done: boolean; warning: string | null };

function botPass(pull: PullRequest, bot: KnownBot): BotPass {
	if (bot === "codex" && eyesStillRunning(pull)) {
		return { done: false, warning: null };
	}
	const warning = botWarning(pull, bot);
	if (warning !== null) {
		return { done: true, warning };
	}
	if (bot === "grok") {
		const check = pull.checks.find((item) => botCheck.grok.test(item.name));
		const review = pull.reviews.find(
			(item) => item.login === botLogin.grok && item.commitId === pull.headSha,
		);
		const done = check?.status === "completed" && review !== undefined;
		return { done, warning: null };
	}
	if (bot === "codex") {
		const summary = pull.comments.find(
			(comment) =>
				comment.login === botLogin.codex && comment.body.includes(codexMarker),
		);
		const rows = [...(summary?.body.matchAll(codexRow) ?? [])];
		const completed =
			summary !== undefined &&
			rows.length > 0 &&
			rows.some((row) => (row[2] ?? "").includes("Completed"));
		const reactionOnly =
			summary === undefined &&
			pull.reactions.some(
				(reaction) =>
					reaction.login === botLogin.codex && reaction.content !== "eyes",
			);
		return { done: completed || reactionOnly, warning: null };
	}
	const summary = pull.comments.find(
		(comment) =>
			comment.login === botLogin.greptile &&
			comment.body.includes(greptileMarker),
	);
	const running = pull.checks.some(
		(check) =>
			botCheck.greptile.test(check.name) && check.status !== "completed",
	);
	return { done: summary !== undefined && !running, warning: null };
}

function botWarning(pull: PullRequest, bot: KnownBot): string | null {
	const check = pull.checks.find((item) => botCheck[bot].test(item.name));
	if (check?.status === "completed") {
		if (
			check.conclusion === "failure" ||
			check.conclusion === "cancelled" ||
			check.conclusion === "skipped" ||
			check.conclusion === "timed_out"
		) {
			return `${bot} ${check.conclusion}`;
		}
	}
	const login = botLogin[bot];
	const limited = pull.comments.some(
		(comment) =>
			comment.login === login &&
			usageLimit.test(comment.body) &&
			countsForHead(pull, bot, comment.createdAt),
	);
	return limited ? `${bot} usage limit` : null;
}

function eyesStillRunning(pull: PullRequest): boolean {
	const eyes = pull.reactions.filter(
		(reaction) =>
			reaction.login === botLogin.codex && reaction.content === "eyes",
	);
	if (eyes.length === 0) {
		return false;
	}
	if (eyes.some((reaction) => reaction.createdAt === null)) {
		return true;
	}
	const eyesAt = newestAt(eyes.map((reaction) => reaction.createdAt));
	const limitAt = newestAt(
		pull.comments
			.filter(
				(comment) =>
					comment.login === botLogin.codex && usageLimit.test(comment.body),
			)
			.map((comment) => comment.createdAt),
	);
	if (eyesAt === null || limitAt === null) {
		return true;
	}
	return Date.parse(eyesAt) >= Date.parse(limitAt);
}

function newestAt(times: (string | null)[]): string | null {
	let newest: string | null = null;
	for (const time of times) {
		if (time === null) {
			continue;
		}
		if (newest === null || Date.parse(time) > Date.parse(newest)) {
			newest = time;
		}
	}
	return newest;
}

function countsForHead(
	pull: PullRequest,
	bot: KnownBot,
	createdAt: string | null,
): boolean {
	if (bot !== "grok") {
		return true;
	}
	if (pull.headCommittedAt === null || createdAt === null) {
		return false;
	}
	return Date.parse(createdAt) > Date.parse(pull.headCommittedAt);
}

function reviewState(
	pulls: PullRequest[],
	expectedByRepo: Map<string, KnownBot[]>,
	comments: Comment[] = [],
): { state: "inReview" | "awaitingMerge" | null; tags: string[] } {
	const open = pulls.filter((pull) => !pull.merged);
	if (open.length === 0 || open.some((pull) => pull.draft)) {
		return { state: null, tags: [] };
	}
	const tags: string[] = [];
	let waiting = false;
	for (const pull of open) {
		const run = workcellRun(comments, pull);
		const cycle = run ?? botCycle(pull, expectedByRepo);
		for (const tag of cycle.tags) {
			tags.push(tag);
		}
		if (cycle.state === "inReview") {
			waiting = true;
		}
	}
	return { state: waiting ? "inReview" : "awaitingMerge", tags };
}

function botCycle(
	pull: PullRequest,
	expectedByRepo: Map<string, KnownBot[]>,
): { state: "inReview" | "awaitingMerge"; tags: string[] } {
	const tags: string[] = [];
	let waiting = false;
	for (const bot of expectedByRepo.get(pull.repo) ?? []) {
		const pass = botPass(pull, bot);
		if (pass.warning !== null) {
			tags.push(pass.warning);
		}
		if (!pass.done) {
			waiting = true;
		}
	}
	return { state: waiting ? "inReview" : "awaitingMerge", tags };
}

const progressHeading = "**Workcell progress**";
const stageLine = /^stage\s+(\d+)\b/i;
const mergeAskLine = /^Merge PR #(\d+)\b/i;
const reportMarker = "<!-- workcell:report -->";
function pullNumbers(text: string): number[] {
	const numbers: number[] = [];
	for (const match of text.matchAll(/\/pull\/(\d+)\b/gi)) {
		const number = Number(match[1]);
		if (!numbers.includes(number)) {
			numbers.push(number);
		}
	}
	const asked = text.match(mergeAskLine)?.[1];
	if (asked !== undefined) {
		const number = Number(asked);
		if (!numbers.includes(number)) {
			numbers.push(number);
		}
	}
	return numbers;
}

function workcellRun(
	comments: Comment[],
	pull: PullRequest,
): { state: "inReview" | "awaitingMerge"; tags: string[] } | null {
	const progress = comments.find(
		(comment) => comment.body.split("\n")[0]?.trim() === progressHeading,
	);
	if (progress === undefined) {
		return null;
	}
	const lines = progress.body
		.split("\n")
		.map((line) => line.trim().replace(/^-\s*/, ""))
		.filter((line) => line !== "" && line !== progressHeading);
	let stage: number | null = null;
	for (const line of lines) {
		const stageMatch = line.match(stageLine);
		if (stageMatch?.[1] !== undefined && lineDecidesPull(line, pull, lines)) {
			stage = Number(stageMatch[1]);
		}
	}
	const progressAt = comments.indexOf(progress);
	const later = comments.slice(progressAt + 1);
	const mergeAsk = openMergeAsk(later, pull.number);
	if (
		mergeAsk !== null &&
		!askAnswered(later.slice(mergeAsk.index + 1), mergeAsk.id)
	) {
		return { state: "awaitingMerge", tags: [] };
	}
	if (
		later.some(
			(comment) =>
				comment.body.includes(reportMarker) &&
				commentDecidesPull(comment.body, pull),
		)
	) {
		return { state: "awaitingMerge", tags: [] };
	}
	if (stage !== null && stage <= 5) {
		return { state: "inReview", tags: [] };
	}
	return null;
}

function lineDecidesPull(
	line: string,
	pull: PullRequest,
	lines: string[],
): boolean {
	const numbers = pullNumbers(line);
	if (numbers.length > 0) {
		return numbers.includes(pull.number);
	}
	return !lines.some((item) => pullNumbers(item).length > 0);
}

function commentDecidesPull(body: string, pull: PullRequest): boolean {
	const numbers = pullNumbers(body);
	return numbers.length === 0 || numbers.includes(pull.number);
}

function openMergeAsk(
	later: Comment[],
	number: number,
): { id: string; index: number } | null {
	let found: { id: string; index: number } | null = null;
	for (const [index, comment] of later.entries()) {
		const first = comment.body.split("\n")[0]?.trim() ?? "";
		const asked = first.match(mergeAskLine)?.[1];
		if (asked === undefined || Number(asked) !== number) {
			continue;
		}
		const marker = askId(comment.body);
		if (marker !== null) {
			found = { id: marker, index };
		}
	}
	return found;
}

function askAnswered(later: Comment[], id: string): boolean {
	return later.some(
		(comment) =>
			quotesAsk(comment.body, id) || answerPrefix.test(comment.body.trim()),
	);
}

function shownState(
	ticket: Ticket,
	state: TicketState,
	links: PullRequest[],
	branches: string[],
	startedKeys: string[],
	review: { state: "inReview" | "awaitingMerge" | null },
): TicketState {
	const key = ticket.key;
	const started =
		key !== null &&
		startedKeys.some((item) => item.toLowerCase() === key.toLowerCase());
	const pushed =
		key !== null && branches.some((branch) => branchLinksTicket(branch, key));
	const draft = links.some((pull) => pull.draft);
	const moving = draft || pushed || started;
	if (state === "backlog" && draft) {
		return "inProgress";
	}
	if (state === "backlog" && review.state !== null) {
		return review.state;
	}
	if (state === "backlog" && moving) {
		return "inProgress";
	}
	return state;
}

function pullKey(pull: PullRequest): string {
	return `${pull.repo}#${pull.number}`;
}

export function projectCounts(
	name: string,
	key: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
	pulls: PullRequest[],
	branches: string[],
	startedKeys: string[],
	all: { project: string; tickets: Ticket[] }[],
	expectedBots: Map<string, KnownBot[]>,
	status: FetchStatus,
	rules: Omit<NeedsYouRules, "noSenior"> & {
		noSenior: Record<string, boolean>;
	},
): {
	counts: ProjectCounts;
	needsYou: NeedsYouItem[];
	report: ProjectReport;
} {
	const index = indexTickets(all.flatMap((group) => group.tickets));
	const parsed = parseBodies(all);
	const counts = {
		done: 0,
		dropped: 0,
		blocked: 0,
		backlog: 0,
		inProgress: 0,
		inReview: 0,
		awaitingMerge: 0,
	};
	const tags = new Set<string>();
	const views: TicketView[] = [];
	const shownByKey = new Map<string, TicketState>();
	const cross = new Map<string, CrossProjectBlocker>();
	const active = pulls.filter((pull) => !pull.merged);
	const linkedByTicket = new Map<string, PullRequest[]>();
	const linkedKeys = new Set<string>();
	for (const ticket of tickets) {
		const blockers = openBlockers(ticket, index, parsed);
		const state = ticketState(
			ticket,
			blockers.flatMap((blocker) => {
				const ref = asRef(blocker);
				return ref === null ? [] : [ref];
			}),
		);
		const links = linked(ticket, active, name);
		for (const pull of links) {
			linkedKeys.add(pullKey(pull));
		}
		if (ticket.state === "open" && ticket.key !== null) {
			linkedByTicket.set(ticket.key, links);
		}
		const review = reviewState(links, expectedBots, ticket.comments ?? []);
		for (const tag of review.tags) {
			tags.add(tag);
		}
		const shown = shownState(
			ticket,
			state,
			links,
			branches,
			startedKeys,
			review,
		);
		if (ticket.key !== null) {
			shownByKey.set(ticket.key, shown);
		}
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
	const unlinked = active.filter((pull) => !linkedKeys.has(pullKey(pull)));
	const unlinkedPrs = unlinked.map((pull) => ({
		number: pull.number,
		title: pull.title,
		url: pull.url,
	}));
	const needsYouItemsForProject = needsYouItems(
		name,
		tracker,
		tickets,
		active,
		unlinked,
		linkedByTicket,
		expectedBots,
		shownByKey,
		{
			labels: rules.labels,
			viewerLogins: rules.viewerLogins,
			noSenior: projectHasNoSenior(rules.noSenior, key, tracker),
		},
	);
	const unlinkedReview = reviewState(unlinked, expectedBots, []);
	for (const tag of unlinkedReview.tags) {
		tags.add(tag);
	}
	const project: ProjectCounts = {
		name,
		tracker,
		...counts,
		unlinkedPrs,
		tickets: views,
		crossProjectBlockers: [...cross.values()],
		needsYou: needsYouItemsForProject.length,
		progress: progressRatio(counts),
		...staleView(status, status.fetchedAt),
		tags: [...tags],
	};
	const report = projectReport(project, tickets, needsYouItemsForProject);
	return {
		counts: project,
		needsYou: needsYouItemsForProject,
		report,
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
const workcellMarker = /<!--\s*workcell:/i;
const answerPrefix = /^(?:senior|reply|answer)\b/i;
const decisionRecord = /^\**\s*decision\b/i;
const nameCue =
	/\b(?:waits on|held for|left for|decision|verify|restore|passphrase|signing key)\b/i;

export type NeedsYouRules = {
	noSenior: boolean;
	labels: string[];
	viewerLogins: string[];
};

function projectHasNoSenior(
	noSenior: Record<string, boolean>,
	key: string,
	tracker: "github" | "linear",
): boolean {
	const match = Object.entries(noSenior).find(
		([name]) => name.toLowerCase() === key.toLowerCase(),
	);
	return match?.[1] ?? tracker === "linear";
}

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

function quotesAskText(body: string, askBody: string): boolean {
	const text = askBody.replace(askMarker, "").trim();
	if (text === "") {
		return false;
	}
	return body
		.split("\n")
		.some((line) => line.trimStart().startsWith(">") && line.includes(text));
}

function commentTime(comment: Comment): number {
	if (comment.createdAt === undefined) {
		return 0;
	}
	const parsed = Date.parse(comment.createdAt);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function orderedComments(comments: Comment[]): Comment[] {
	return comments.every((comment) => comment.createdAt === undefined)
		? comments
		: [...comments].sort(
				(left, right) => commentTime(left) - commentTime(right),
			);
}

function namesLev(body: string): boolean {
	return /\blev\b/i.test(body);
}

function opensForSenior(body: string): boolean {
	const opening = body.trim().slice(0, 240).toLowerCase();
	return /\b(?:senior|for the senior)\b/.test(opening);
}

function matchedByName(body: string): boolean {
	if (!namesLev(body)) {
		return false;
	}
	const cueAt = body.search(nameCue);
	const nameAt = body.search(/\blev\b/i);
	return cueAt >= 0 && nameAt >= 0 && Math.abs(cueAt - nameAt) <= 80;
}

function addressedToLev(body: string, noSenior: boolean): boolean {
	if (decisionRecord.test(body.trim())) {
		return false;
	}
	const named = matchedByName(body);
	if (opensForSenior(body) && !namesLev(body)) {
		return false;
	}
	if (noSenior) {
		return true;
	}
	return named;
}

function progressPicked(body: string, id: string): boolean {
	if (!body.trimStart().startsWith(progressHeading)) {
		return false;
	}
	const line = body
		.split("\n")
		.find((item) => item.replace(/^\s*-?\s*/, "").startsWith(`ask-${id}:`));
	return line !== undefined && /human picks\b/i.test(line);
}

function askClosed(later: Comment[], id: string): boolean {
	return later.some(
		(item) => quotesAsk(item.body, id) || progressPicked(item.body, id),
	);
}

function askHeadline(body: string): string {
	const text = body.replace(askMarker, "").trim();
	const named = text
		.split(/(?<=[.!?])\s+/)
		.map((part) => part.trim())
		.find((part) => namesLev(part));
	if (named !== undefined) {
		return named.replace(/^senior,\s*/i, "");
	}
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("<!--"));
	return lines.at(-1) ?? text;
}

type OpenAsk = {
	headline: string;
	tags: string[];
	index: number;
};

function openAsk(comments: Comment[], noSenior: boolean): OpenAsk | null {
	const ordered = orderedComments(comments);
	const latest = new Map<string, number>();
	ordered.forEach((comment, index) => {
		const id = askId(comment.body);
		if (id !== null) {
			latest.set(id, index);
		}
	});
	let found: OpenAsk | null = null;
	for (const [id, index] of latest) {
		const comment = ordered[index];
		if (comment === undefined || !addressedToLev(comment.body, noSenior)) {
			continue;
		}
		if (askClosed(ordered.slice(index + 1), id)) {
			continue;
		}
		if (found === null || index > found.index) {
			found = {
				headline: askHeadline(comment.body),
				tags: matchedByName(comment.body) ? ["matched by name"] : [],
				index,
			};
		}
	}
	return found;
}

function replyAfter(comments: Comment[], askIndex: number): Comment | null {
	const ordered = orderedComments(comments);
	const ask = ordered[askIndex];
	if (ask === undefined) {
		return null;
	}
	const id = askId(ask.body);
	for (let index = ordered.length - 1; index > askIndex; index -= 1) {
		const comment = ordered[index];
		if (comment === undefined || workcellMarker.test(comment.body)) {
			continue;
		}
		const opening = comment.body.trim();
		if (
			(id !== null && quotesAsk(opening, id)) ||
			answerPrefix.test(opening) ||
			quotesAskText(opening, ask.body)
		) {
			return comment;
		}
	}
	return null;
}

function assignedToViewer(ticket: Ticket, viewers: Set<string>): boolean {
	const names = [
		...(ticket.assignees ?? []),
		...(ticket.assignee === undefined || ticket.assignee === null
			? []
			: [ticket.assignee]),
	];
	return names.some((name) => {
		const trimmed = name.trim().toLowerCase();
		return trimmed !== "" && viewers.has(trimmed);
	});
}

function needsYouItem(
	project: string,
	tracker: ProjectCounts["tracker"],
	key: string,
	title: string,
	ask: OpenAsk | null,
	comments: Comment[],
	reason: NeedsYouItem["reason"],
): NeedsYouItem {
	const reply = ask === null ? null : replyAfter(comments, ask.index);
	return {
		project,
		tracker,
		key,
		headline: ask?.headline ?? title,
		reason,
		tags: ask?.tags ?? [],
		answered: reply !== null,
		acknowledged: (reply?.reactions ?? 0) > 0,
	};
}

function pullComments(pull: PullRequest): Comment[] {
	return pull.comments.map((comment) => ({
		body: comment.body,
		...(comment.createdAt === null ? {} : { createdAt: comment.createdAt }),
		author: comment.login,
		...(comment.reactions === undefined
			? {}
			: { reactions: comment.reactions }),
	}));
}

export function needsYouItems(
	project: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
	pulls: PullRequest[],
	unlinkedPulls: PullRequest[],
	linkedByTicket: Map<string, PullRequest[]>,
	expectedBots: Map<string, KnownBot[]>,
	shownByKey: Map<string, TicketState>,
	rules: NeedsYouRules,
): NeedsYouItem[] {
	const labels = new Set(rules.labels.map((label) => label.toLowerCase()));
	const viewers = new Set(
		rules.viewerLogins.map((login) => login.toLowerCase()),
	);
	const items: NeedsYouItem[] = [];
	for (const ticket of tickets) {
		if (ticket.state !== "open" || ticket.key === null) {
			continue;
		}
		const shown = shownByKey.get(ticket.key);
		const linkedPulls = linkedByTicket.get(ticket.key) ?? [];
		const comments = [
			...(ticket.comments ?? []),
			...linkedPulls.flatMap(pullComments),
		];
		const ask = openAsk(comments, rules.noSenior);
		const labelled =
			assignedToViewer(ticket, viewers) &&
			ticket.labels.some((label) => labels.has(label.toLowerCase()));
		const awaiting = shown === "awaitingMerge";
		if (ask === null && !labelled && !awaiting) {
			continue;
		}
		items.push(
			needsYouItem(
				project,
				tracker,
				ticket.key,
				ticket.title,
				ask,
				comments,
				ask !== null ? "ask" : awaiting ? "awaitingMerge" : "label",
			),
		);
	}
	const folded = new Set(
		[...linkedByTicket.values()].flat().map((pull) => pullKey(pull)),
	);
	for (const pull of pulls) {
		if (folded.has(pullKey(pull))) {
			continue;
		}
		const comments = pullComments(pull);
		const ask = openAsk(comments, rules.noSenior);
		if (ask === null) {
			continue;
		}
		items.push(
			needsYouItem(
				project,
				"github",
				pullKey(pull),
				pull.title,
				ask,
				comments,
				"ask",
			),
		);
	}
	const listed = new Set(items.map((item) => item.key));
	for (const pull of unlinkedPulls) {
		const key = pullKey(pull);
		if (listed.has(key)) {
			continue;
		}
		if (reviewState([pull], expectedBots, []).state !== "awaitingMerge") {
			continue;
		}
		items.push(
			needsYouItem(
				project,
				"github",
				key,
				pull.title,
				null,
				[],
				"awaitingMerge",
			),
		);
	}
	items.sort((left, right) => Number(left.answered) - Number(right.answered));
	return items;
}

const noScope = "no scope";
const noWorkstream = "no workstream";

const scopeInTitle = /^(?:[a-z]+)\(([^)]+)\)!?\s*:|^\[([^\]]+)\]/i;

function scopeOf(title: string): string {
	const match = title.match(scopeInTitle);
	const scope = match?.[1] ?? match?.[2];
	if (scope === undefined || scope.trim() === "") {
		return noScope;
	}
	return scope.trim().toLowerCase();
}

function mermaidId(value: string): string {
	const id = [...value]
		.map((char) => {
			if (/[A-Za-z0-9]/.test(char)) {
				return char;
			}
			const code = char.codePointAt(0) ?? 0;
			return `_${code.toString(16)}_`;
		})
		.join("");
	return /^[A-Za-z]/.test(id) ? id : `n_${id}`;
}

function mermaidLabel(value: string): string {
	return value.replace(/"/g, "#quot;");
}

type Placed = {
	ticket: Ticket;
	view: TicketView;
	workstream: string;
	theme: string;
};

function parentOf(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): Ticket | undefined {
	const parentKey = ticket.parent;
	if (parentKey === null) {
		return undefined;
	}
	return byKey.get(parentKey.toLowerCase());
}

function* ancestors(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): Generator<Ticket> {
	const seen = new Set<string>();
	let current = ticket;
	for (;;) {
		const parent = parentOf(current, byKey);
		if (parent === undefined || parent.key === null) {
			return;
		}
		const key = parent.key.toLowerCase();
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		yield parent;
		current = parent;
	}
}

function rootOf(ticket: Ticket, byKey: Map<string, Ticket>): Ticket {
	let root = ticket;
	for (const parent of ancestors(ticket, byKey)) {
		root = parent;
	}
	return root;
}

function isEpic(ticket: Ticket): boolean {
	return ticket.labels.some((label) => label.toLowerCase() === "epic");
}

function themeOf(
	ticket: Ticket,
	root: Ticket,
	byKey: Map<string, Ticket>,
	parents: Set<string>,
): string {
	if (isEpic(ticket)) {
		return ticket.title;
	}
	const parent = parentOf(ticket, byKey);
	if (parent !== undefined && isEpic(parent) && parent !== root) {
		return parent.title;
	}
	if (isEpic(root) && root === ticket) {
		return root.title;
	}
	const belowRoot = [...ancestors(ticket, byKey)].find(
		(ancestor) => ancestor !== root,
	);
	if (isEpic(root) && belowRoot !== undefined) {
		return belowRoot.title;
	}
	if (isEpic(root)) {
		return scopeOf(ticket.title);
	}
	if (root !== ticket && root.key !== null) {
		return root.title;
	}
	if (ticket.key !== null && parents.has(ticket.key.toLowerCase())) {
		return ticket.title;
	}
	return scopeOf(ticket.title);
}

function linearMilestone(
	ticket: Ticket,
	byKey: Map<string, Ticket>,
): string | null {
	if (ticket.milestone !== null) {
		return ticket.milestone;
	}
	for (const parent of ancestors(ticket, byKey)) {
		if (parent.milestone !== null) {
			return parent.milestone;
		}
	}
	return null;
}

function workstreamOf(
	ticket: Ticket,
	root: Ticket,
	tracker: ProjectCounts["tracker"],
	byKey: Map<string, Ticket>,
): string {
	if (tracker === "linear") {
		return linearMilestone(ticket, byKey) ?? noWorkstream;
	}
	if (isEpic(root)) {
		return root.title;
	}
	return ticket.milestone ?? noWorkstream;
}

function placeTickets(
	tickets: Ticket[],
	views: TicketView[],
	tracker: ProjectCounts["tracker"],
): Placed[] {
	const byKey = new Map<string, Ticket>();
	for (const ticket of tickets) {
		if (ticket.key !== null) {
			byKey.set(ticket.key.toLowerCase(), ticket);
		}
	}
	const parents = new Set<string>();
	for (const ticket of tickets) {
		const parent = parentOf(ticket, byKey);
		if (parent?.key !== null && parent?.key !== undefined) {
			parents.add(parent.key.toLowerCase());
		}
	}
	return tickets.flatMap((ticket, index) => {
		const view = views[index];
		if (view === undefined) {
			return [];
		}
		const root = rootOf(ticket, byKey);
		return [
			{
				ticket,
				view,
				workstream: workstreamOf(ticket, root, tracker, byKey),
				theme: themeOf(ticket, root, byKey, parents),
			},
		];
	});
}

function nodeOf(
	placed: Placed,
	project: string,
	tracker: ProjectCounts["tracker"],
): DiagramNode {
	const key = placed.ticket.key ?? placed.view.title;
	return {
		id: mermaidId(key),
		label: placed.view.title,
		state: placed.view.state,
		dashed: false,
		project,
		tracker,
		ticket: placed.ticket.key,
	};
}

function externalNode(blocker: CrossProjectBlocker): DiagramNode {
	return {
		id: mermaidId(`${blocker.tracker}:${blocker.project}:${blocker.key}`),
		label: `${blocker.project} ${blocker.key}`,
		state: "external",
		dashed: true,
		project: blocker.project,
		tracker: blocker.tracker,
		ticket: blocker.key,
	};
}

const stateFill: Record<TicketState, string> = {
	done: "#8fbc8f",
	dropped: "#9ca3af",
	blocked: "#e6a0a0",
	backlog: "#d0d7de",
	inProgress: "#f0c674",
	inReview: "#9ecbff",
	awaitingMerge: "#b7e1cd",
};

function defineDiagram(diagram: Omit<Diagram, "definition">): Diagram {
	const lines = [`flowchart ${diagram.direction}`];
	for (const node of diagram.nodes) {
		const shape = `["${mermaidLabel(node.label)}"]`;
		const klass = node.dashed ? ":::dashed" : `:::${node.state}`;
		lines.push(`  ${node.id}${shape}${klass}`);
	}
	for (const edge of diagram.edges) {
		lines.push(`  ${edge.from} --> ${edge.to}`);
	}
	for (const state of Object.keys(stateFill) as TicketState[]) {
		lines.push(`  classDef ${state} fill:${stateFill[state]}`);
	}
	lines.push("  classDef theme fill:#e8eef7,stroke:#1a5fb4");
	lines.push("  classDef dashed fill:#fff,stroke:#888,stroke-dasharray: 5 5");
	return { ...diagram, definition: `${lines.join("\n")}\n` };
}

function crossNode(
	key: string,
	cross: CrossProjectBlocker[],
): DiagramNode | undefined {
	const outside = cross.find(
		(blocker) => blocker.key.toLowerCase() === key.toLowerCase(),
	);
	return outside === undefined ? undefined : externalNode(outside);
}

function featureDiagrams(
	placed: Placed[],
	project: string,
	tracker: ProjectCounts["tracker"],
	cross: CrossProjectBlocker[],
): Diagram[] {
	const groups = new Map<string, Map<string, Placed[]>>();
	for (const item of placed) {
		const themes = groups.get(item.workstream) ?? new Map<string, Placed[]>();
		const items = themes.get(item.theme) ?? [];
		items.push(item);
		themes.set(item.theme, items);
		groups.set(item.workstream, themes);
	}
	const diagrams: Diagram[] = [];
	const workstreams = [...groups.keys()].sort((left, right) =>
		left.localeCompare(right),
	);
	for (const workstream of workstreams) {
		const themes = groups.get(workstream);
		if (themes === undefined) {
			continue;
		}
		const nodes: DiagramNode[] = [];
		const edges: DiagramEdge[] = [];
		const seen = new Set<string>();
		for (const theme of [...themes.keys()].sort((left, right) =>
			left.localeCompare(right),
		)) {
			const themeId = mermaidId(`${workstream}:${theme}`);
			nodes.push({
				id: themeId,
				label: theme,
				state: "theme",
				dashed: false,
				project,
				tracker,
				ticket: null,
			});
			seen.add(themeId);
			const items = [...(themes.get(theme) ?? [])]
				.map((item) => ({ item, node: nodeOf(item, project, tracker) }))
				.sort((left, right) => left.node.id.localeCompare(right.node.id));
			for (const { item, node } of items) {
				if (!seen.has(node.id)) {
					nodes.push(node);
					seen.add(node.id);
				}
				edges.push({ from: themeId, to: node.id });
				for (const key of item.view.blockers) {
					const external = crossNode(key, cross);
					if (external === undefined) {
						continue;
					}
					if (!seen.has(external.id)) {
						nodes.push(external);
						seen.add(external.id);
					}
					edges.push({ from: external.id, to: node.id });
				}
			}
		}
		diagrams.push(
			defineDiagram({
				id: mermaidId(`map:${workstream}`),
				title: workstream,
				direction: "TD",
				nodes,
				edges,
			}),
		);
	}
	return diagrams;
}

function chainDiagrams(
	placed: Placed[],
	project: string,
	tracker: ProjectCounts["tracker"],
	cross: CrossProjectBlocker[],
): Diagram[] {
	const blocked = placed.filter((item) => item.view.state === "blocked");
	if (blocked.length === 0) {
		return [];
	}
	const nodes: DiagramNode[] = [];
	const edges: DiagramEdge[] = [];
	const seen = new Set<string>();
	const add = (node: DiagramNode) => {
		if (seen.has(node.id)) {
			return;
		}
		seen.add(node.id);
		nodes.push(node);
	};
	for (const item of blocked) {
		const node = nodeOf(item, project, tracker);
		add(node);
		for (const key of item.view.blockers) {
			const local = placed.find(
				(candidate) =>
					candidate.ticket.key?.toLowerCase() === key.toLowerCase(),
			);
			if (local !== undefined) {
				const blocker = nodeOf(local, project, tracker);
				add(blocker);
				edges.push({ from: blocker.id, to: node.id });
				continue;
			}
			const external = crossNode(key, cross);
			if (external === undefined) {
				continue;
			}
			add(external);
			edges.push({ from: external.id, to: node.id });
		}
	}
	nodes.sort((left, right) => left.id.localeCompare(right.id));
	edges.sort((left, right) =>
		`${left.from} ${left.to}`.localeCompare(`${right.from} ${right.to}`),
	);
	return [
		defineDiagram({
			id: "blocking_chains",
			title: "Blocking chains",
			direction: "LR",
			nodes,
			edges,
		}),
	];
}

function summaryLine(counts: ProjectCounts): string {
	return `${counts.name}: ${counts.done} done, ${counts.dropped} dropped, ${counts.blocked} blocked, ${counts.inProgress} in progress, ${counts.backlog} backlog.`;
}

export function projectReport(
	counts: ProjectCounts,
	tickets: Ticket[],
	needs: NeedsYouItem[] = [],
): ProjectReport {
	const placed = placeTickets(tickets, counts.tickets, counts.tracker);
	const maps = featureDiagrams(
		placed,
		counts.name,
		counts.tracker,
		counts.crossProjectBlockers,
	);
	const chains = chainDiagrams(
		placed,
		counts.name,
		counts.tracker,
		counts.crossProjectBlockers,
	);
	const inFlight = [
		...counts.tickets.filter((ticket) => ticket.state === "inProgress"),
		...counts.unlinkedPrs.map((pull) => ({
			key: `#${pull.number}`,
			title: pull.title,
			state: "inProgress" as const,
			blockers: [],
		})),
	];
	const backlog = counts.tickets.filter((ticket) => ticket.state === "backlog");
	const sections: ReportSection[] = [
		{ id: "summary", title: "Summary", text: summaryLine(counts) },
		{ id: "featureMap", title: "Feature map", diagrams: maps },
		{ id: "inFlight", title: "In flight", items: inFlight },
		{ id: "blockingChains", title: "Blocking chains", diagrams: chains },
		{
			id: "needsYou",
			title: "Needs you",
			needsYou: needs,
		},
		{ id: "backlog", title: "Backlog", items: backlog },
	];
	return {
		name: counts.name,
		tracker: counts.tracker,
		sections,
	};
}
