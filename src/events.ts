type AppEvent = "overview" | "views" | "notification" | "progress";
type StreamEvent = "open" | AppEvent;

type Listener = (event: MessageEvent) => void;

/** A message between the tabs of the page: a stream event, or a new tab asking for the latest events. */
type Wire =
	{ kind: "event"; name: StreamEvent; data: string } | { kind: "hello" };

const appEvents: AppEvent[] = ["overview", "views", "notification", "progress"];
const sharedName = "project-flow-events";

const listeners = new Map<StreamEvent, Set<Listener>>();
const latest = new Map<AppEvent, MessageEvent>();
let source: EventSource | null = null;
let channel: BroadcastChannel | null = null;
let leaving: AbortController | null = null;
let users = 0;

function remember(name: AppEvent, event: MessageEvent): void {
	latest.set(name, event);
	if (name === "progress") {
		const progress = JSON.parse(event.data) as { ended?: boolean };
		if (progress.ended === true) {
			latest.delete(name);
		}
	}
}

function deliver(name: StreamEvent, data: string): void {
	const event = new MessageEvent(name, { data });
	if (name !== "open") {
		remember(name, event);
	}
	for (const listener of listeners.get(name) ?? []) {
		listener(event);
	}
}

function relay(name: StreamEvent, data: string): void {
	deliver(name, data);
	channel?.postMessage({ kind: "event", name, data } satisfies Wire);
}

function stream(): EventSource {
	const opened = new EventSource("/api/events");
	for (const name of appEvents) {
		opened.addEventListener(name, (event) => relay(name, event.data));
	}
	opened.addEventListener("open", () => relay("open", ""));
	return opened;
}

/**
 * Connects this tab to the one event stream that all tabs share. The tab that holds the lock reads the stream and relays each event.
 * A browser opens only a few connections to one host, and a stream holds one for good, so a stream per tab blocks new tabs.
 */
function connect(): void {
	if (source !== null || channel !== null) {
		return;
	}
	if (typeof BroadcastChannel === "undefined" || !("locks" in navigator)) {
		source = stream();
		return;
	}
	const shared = new BroadcastChannel(sharedName);
	channel = shared;
	shared.addEventListener("message", (message: MessageEvent<Wire>) => {
		const wire = message.data;
		if (wire.kind === "event") {
			deliver(wire.name, wire.data);
			return;
		}
		if (source !== null) {
			for (const [name, event] of latest) {
				shared.postMessage({
					kind: "event",
					name,
					data: event.data,
				} satisfies Wire);
			}
		}
	});
	shared.postMessage({ kind: "hello" } satisfies Wire);
	const leave = new AbortController();
	leaving = leave;
	navigator.locks
		.request(sharedName, { signal: leave.signal }, () => {
			source = stream();
			return new Promise<void>((resolve) => {
				leave.signal.addEventListener("abort", () => resolve());
			});
		})
		.catch(() => {});
}

function disconnect(): void {
	leaving?.abort();
	leaving = null;
	source?.close();
	source = null;
	channel?.close();
	channel = null;
}

function subscribe(name: StreamEvent, listener: Listener): () => void {
	const current = listeners.get(name) ?? new Set<Listener>();
	current.add(listener);
	listeners.set(name, current);
	connect();
	if (name !== "open") {
		const missed = latest.get(name);
		if (missed !== undefined) {
			listener(missed);
		}
	}
	users += 1;
	return () => {
		current.delete(listener);
		if (current.size === 0) {
			listeners.delete(name);
		}
		users -= 1;
		if (users === 0) {
			disconnect();
		}
	};
}

export function onEventStreamOpen(listener: () => void): () => void {
	return subscribe("open", () => {
		listener();
	});
}

export function onAppEvent(name: AppEvent, listener: Listener): () => void {
	return subscribe(name, listener);
}
