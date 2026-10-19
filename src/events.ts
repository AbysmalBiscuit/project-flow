type AppEvent = "overview" | "notification";
type StreamEvent = "open" | AppEvent;

type Listener = (event: MessageEvent) => void;

const listeners = new Map<StreamEvent, Set<Listener>>();
let source: EventSource | null = null;
let users = 0;

function open(): EventSource {
	if (source === null) {
		source = new EventSource("/api/events");
		for (const name of listeners.keys()) {
			for (const listener of listeners.get(name) ?? []) {
				source.addEventListener(name, listener);
			}
		}
	}
	return source;
}

function subscribe(name: StreamEvent, listener: Listener): () => void {
	const current = listeners.get(name) ?? new Set<Listener>();
	current.add(listener);
	listeners.set(name, current);
	if (source === null) {
		open();
	} else {
		source.addEventListener(name, listener);
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
