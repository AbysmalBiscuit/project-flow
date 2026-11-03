import { pendingStatus } from "../../src/stale-reads.ts";

export type ChangeEvent = {
	event: string;
	data: string;
};

/** Read a stale-while-revalidate route again until its first background read has answered. */
export async function settledRead(url: URL): Promise<Response> {
	while (true) {
		const response = await fetch(url);
		if (response.status !== pendingStatus) {
			return response;
		}
		await Bun.sleep(5);
	}
}

/** Read a stale-while-revalidate route again until a background read brings an answer that `accept` takes. */
export async function readWhere<Body>(
	url: URL,
	accept: (body: Body) => boolean,
): Promise<Body> {
	while (true) {
		const body = (await (await settledRead(url)).json()) as Body;
		if (accept(body)) {
			return body;
		}
		await Bun.sleep(5);
	}
}

export async function settledOverview<Body extends { polling?: true }>(
	base: string,
	read: (base: string) => Promise<Body>,
): Promise<Body> {
	let body: Body | null = null;
	while (true) {
		body = await read(base);
		if (body.polling !== true) {
			return body;
		}
		await Bun.sleep(5);
	}
}

export async function settledOverviewEvent<Body extends { polling?: true }>(
	events: AsyncIterator<ChangeEvent>,
	parse: (data: string) => Body,
	limit = 8,
): Promise<Body> {
	for (let seen = 0; seen < limit; seen += 1) {
		const received = await events.next();
		if (received.done || received.value === undefined) {
			break;
		}
		if (received.value.event !== "overview") {
			continue;
		}
		const body = parse(received.value.data);
		if (body.polling !== true) {
			return body;
		}
	}
	throw new Error("the event stream sent no overview after the poll");
}

/** Read the settings once no discovery runs, so the catalogue is the last poll's. */
export function settledSettings<Body = unknown>(
	base: string,
): Promise<Body & { discovering?: true }> {
	return readWhere<Body & { discovering?: true }>(
		new URL("/api/settings", base),
		(body) => body.discovering !== true,
	);
}

export async function trackFound(base: string): Promise<void> {
	const settings = await settledSettings<{ projects: { ref: unknown }[] }>(
		base,
	);
	const saved = await fetch(new URL("/api/settings", base), {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			...settings,
			tracked: settings.projects.map((project) => project.ref),
		}),
	});
	if (!saved.ok) {
		throw new Error(`tracking found projects failed: ${await saved.text()}`);
	}
}

export function overviewOf(data: string): OverviewBody {
	return JSON.parse(data) as OverviewBody;
}

export async function readOverview<Body = OverviewBody>(
	base: string,
): Promise<Body> {
	return (await (await fetch(new URL("/api/overview", base))).json()) as Body;
}

function readSseEvents(buffer: string): {
	events: ChangeEvent[];
	rest: string;
} {
	const blocks = buffer.split("\n\n");
	const rest = blocks.pop() ?? "";
	const events: ChangeEvent[] = [];
	for (const text of blocks) {
		const event = text
			.split("\n")
			.find((line) => line.startsWith("event:"))
			?.slice("event:".length)
			.trim();
		const payload = text
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).trim())
			.join("\n");
		if (event !== undefined && payload !== "") {
			events.push({ event, data: payload });
		}
	}
	return { events, rest };
}

export function openEventStream(base: string): {
	base: string;
	events: AsyncIterable<ChangeEvent>;
	close: () => void;
	ready: Promise<void>;
} {
	const queue: ChangeEvent[] = [];
	let wake: (() => void) | null = null;
	let closed = false;
	let buffer = "";
	let markReady = () => {};
	const ready = new Promise<void>((resolve) => {
		markReady = resolve;
	});
	const socket = Bun.connect({
		hostname: "127.0.0.1",
		port: Number(new URL(base).port),
		socket: {
			data(_socket, data) {
				markReady();
				buffer += data.toString();
				const parsed = readSseEvents(buffer);
				buffer = parsed.rest;
				for (const event of parsed.events) {
					queue.push(event);
					wake?.();
				}
			},
			error(_socket, error) {
				queue.push({ event: "error", data: error.message });
				closed = true;
				wake?.();
			},
			open(socket) {
				socket.write(
					"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n",
				);
			},
		},
	});
	return {
		base,
		events: {
			async *[Symbol.asyncIterator]() {
				while (!closed) {
					const next = queue.shift();
					if (next !== undefined) {
						yield next;
						continue;
					}
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
			},
		},
		close: () => {
			closed = true;
			wake?.();
			void socket.then((open) => open.end());
		},
		ready,
	};
}

export type ShownTicket = {
	key: string | null;
	title: string;
	state: string;
	blockers: string[];
	lane?: string;
	statusType?: string;
	chips?: string[];
	run?: { status: string; stage?: string };
	enteredStateAt?: string;
	updatedAt?: string;
};

/**
 * The tickets of a project, as its unfiltered project report gives them.
 * The report lists the unlinked PRs after the tickets, and `total` counts only the tickets.
 */
export async function projectTickets<Ticket extends ShownTicket = ShownTicket>(
	base: string,
	name: string,
): Promise<Ticket[]> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}?view=all`, base),
	);
	if (!response.ok) {
		throw new Error(`the report of ${name} answered ${response.status}`);
	}
	const report = (await response.json()) as {
		tickets: Ticket[];
		total: number;
	};
	return report.tickets.slice(0, report.total);
}

/** The fields of an overview body that a ticket read needs. */
export type ServedOverview = {
	projects: { name: string; pending?: true }[];
	polling?: true;
	factoryUnreachable?: true;
};

/** An overview, with the tickets of each project card from its project report. */
export type OverviewWithTickets<Ticket extends ShownTicket> = Omit<
	ServedOverview,
	"projects"
> & {
	projects: { name: string; tickets: Ticket[] }[];
};

/** Attach the report tickets of each project card, as the page reads them. A pending card has no report yet. */
export async function withReportTickets<Ticket extends ShownTicket>(
	base: string,
	overview: ServedOverview,
): Promise<OverviewWithTickets<Ticket>> {
	return {
		...overview,
		projects: await Promise.all(
			overview.projects.map(async (card) => ({
				name: card.name,
				tickets:
					card.pending === true
						? []
						: await projectTickets<Ticket>(base, card.name),
			})),
		),
	};
}

function cardFields({
	key,
	title,
	state,
	blockers,
	lane,
	statusType,
	chips,
	enteredStateAt,
	updatedAt,
}: ShownTicket): ShownTicket {
	return {
		key,
		title,
		state,
		blockers,
		...(lane === undefined ? {} : { lane }),
		...(statusType === undefined ? {} : { statusType }),
		...(chips === undefined ? {} : { chips }),
		...(enteredStateAt === undefined ? {} : { enteredStateAt }),
		...(updatedAt === undefined ? {} : { updatedAt }),
	};
}

/**
 * The overview, with the report tickets of each card cut to the fields that an overview card gave them.
 * The report adds `run` from progress comments, so the cut leaves `run` out.
 * A test compares whole cards and their tickets with one `toEqual`.
 */
export async function withCardTickets<Card extends { name: string }>(
	base: string,
	overview: { projects: Card[] },
): Promise<{ projects: (Card & { tickets: ShownTicket[] })[] }> {
	return {
		...overview,
		projects: await Promise.all(
			overview.projects.map(async (card) => ({
				...card,
				tickets: (await projectTickets(base, card.name)).map(cardFields),
			})),
		),
	};
}

/** Read the tickets of a project again until `accept` takes them. */
export async function projectTicketsWhere<
	Ticket extends ShownTicket = ShownTicket,
>(
	base: string,
	name: string,
	accept: (tickets: Ticket[]) => boolean,
): Promise<Ticket[]> {
	while (true) {
		const tickets = await projectTickets<Ticket>(base, name);
		if (accept(tickets)) {
			return tickets;
		}
		await Bun.sleep(5);
	}
}

export type OverviewBody = {
	projects: {
		name: string;
		tracker: string;
		done: number;
		dropped: number;
		blocked: number;
		backlog: number;
		inProgress: number;
		inReview: number;
		awaitingMerge: number;
		tags: string[];
		unlinkedPrs: unknown[];
		crossProjectBlockers: unknown[];
		needsYou: number;
		progress: number;
		fetchedAt: string | null;
		error: string | null;
		pending?: boolean;
		statusTypes: Record<string, number>;
		ref:
			| { tracker: "github"; repo: string }
			| { tracker: "linear"; project: string };
		displayKey: string;
	}[];
	fetchedAt: string | null;
	error: string | null;
	polling?: true;
};
