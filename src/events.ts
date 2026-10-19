type EventName = "overview" | "notification";

type Listener = (event: MessageEvent) => void;

const listeners = new Map<EventName, Set<Listener>>();
let source: EventSource | null = null;
let users = 0;
let onOpen: (() => void) | null = null;

function open(): EventSource {
	if (source === null) {
		source = new EventSource("/api/events");
		source.addEventListener("open", () => {
			onOpen?.();
		});
		for (const name of listeners.keys()) {
			for (const listener of listeners.get(name) ?? []) {
				source.addEventListener(name, listener);
			}
		}
	}
	return source;
}

export function onEventStreamOpen(listener: () => void): void {
	onOpen = listener;
}

export function onAppEvent(name: EventName, listener: Listener): () => void {
	const current = listeners.get(name) ?? new Set<Listener>();
	current.add(listener);
	listeners.set(name, current);
	open().addEventListener(name, listener);
	users += 1;
	return () => {
		current.delete(listener);
		source?.removeEventListener(name, listener);
		users -= 1;
		if (users === 0 && source !== null) {
			source.close();
			source = null;
			onOpen = null;
		}
	};
}
