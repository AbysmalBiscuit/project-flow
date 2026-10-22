type AppEvent = "overview" | "views" | "notification" | "progress";
type StreamEvent = "open" | AppEvent;

type Listener = (event: MessageEvent) => void;

const listeners = new Map<StreamEvent, Set<Listener>>();
const latest = new Map<AppEvent, MessageEvent>();
let source: EventSource | null = null;
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

function open(): EventSource {
	if (source === null) {
		source = new EventSource("/api/events");
		const names: AppEvent[] = ["overview", "views", "notification", "progress"];
		for (const name of names) {
			source.addEventListener(name, (event) => {
				remember(name, event);
				for (const listener of listeners.get(name) ?? []) {
					listener(event);
				}
			});
		}
		source.addEventListener("open", (event) => {
			const message = event as MessageEvent;
			for (const listener of listeners.get("open") ?? []) {
				listener(message);
			}
		});
	}
	return source;
}

function subscribe(name: StreamEvent, listener: Listener): () => void {
	const current = listeners.get(name) ?? new Set<Listener>();
	current.add(listener);
	listeners.set(name, current);
	open();
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
		source?.removeEventListener(name, listener);
		users -= 1;
		if (users === 0 && source !== null) {
			source.close();
			source = null;
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
