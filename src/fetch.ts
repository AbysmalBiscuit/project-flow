export type Fetch = (
	input: string | URL | Request,
	init?: BunFetchRequestInit,
) => Promise<Response>;

function urlOf(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

function isTrackerRequest(input: string | URL | Request): boolean {
	const url = urlOf(input);
	return (
		url.startsWith("https://api.github.com/") ||
		url.startsWith("https://api.linear.app/")
	);
}

export const defaultTrackerRequestLimitMs = 30_000;

export class TrackerRequestTimeout extends Error {
	constructor(limitMs: number) {
		super(`tracker request timed out after ${limitMs / 1000} s`);
		this.name = "TrackerRequestTimeout";
	}
}

async function timedFetch(
	fetchImpl: Fetch,
	input: string | URL | Request,
	init: RequestInit | undefined,
	signal: AbortSignal,
	limitMs: number,
): Promise<Response> {
	const deadline = AbortSignal.timeout(limitMs);
	const timedOut = new Promise<never>((_resolve, reject) => {
		deadline.addEventListener(
			"abort",
			() => reject(new TrackerRequestTimeout(limitMs)),
			{ once: true },
		);
	});
	const sent = fetchImpl(input, {
		...init,
		signal: AbortSignal.any([signal, deadline]),
	});
	try {
		return await Promise.race([sent, timedOut]);
	} catch (error) {
		if (deadline.aborted) {
			throw new TrackerRequestTimeout(limitMs);
		}
		throw error;
	}
}

/**
 * Tracker requests end when `signal` aborts. A request without its own
 * signal also ends after `limitMs`: thread reads carry their own deadline.
 */
export function abortableFetch(
	fetchImpl: Fetch,
	signal: AbortSignal,
	limitMs: number,
): Fetch {
	return (input, init) => {
		if (!isTrackerRequest(input)) {
			return fetchImpl(input, init);
		}
		const caller = init?.signal;
		if (caller === undefined || caller === null) {
			return timedFetch(fetchImpl, input, init, signal, limitMs);
		}
		return fetchImpl(input, {
			...init,
			signal: AbortSignal.any([caller, signal]),
		});
	};
}

export const defaultThreadReadLimitMs = 5_000;

const threadReadTimedOut = "thread read timed out";

export class ThreadReadTimeout extends Error {
	constructor() {
		super(threadReadTimedOut);
		this.name = "ThreadReadTimeout";
	}
}

export async function withThreadLimit<T>(
	read: (signal: AbortSignal) => Promise<T>,
	limitMs: number,
): Promise<T> {
	const deadline = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limited = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			deadline.abort();
			reject(new ThreadReadTimeout());
		}, limitMs);
	});
	const reading = read(deadline.signal);
	reading.catch(() => undefined);
	try {
		return await Promise.race([reading, limited]);
	} catch (error) {
		if (deadline.signal.aborted) {
			throw new ThreadReadTimeout();
		}
		throw error;
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}
