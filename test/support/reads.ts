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
		tickets: ShownTicket[];
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
	}[];
	fetchedAt: string | null;
	error: string | null;
	polling?: true;
};
