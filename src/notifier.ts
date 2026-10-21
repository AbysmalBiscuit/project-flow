import type { Change, Notifier } from "./ports.ts";

export function memoryNotifier(): Notifier {
	const subscribers = new Set<(change: Change) => void>();
	let latest: Change | null = null;
	return {
		publish(change) {
			latest = change;
			for (const send of subscribers) {
				send(change);
			}
		},
		latest() {
			return latest;
		},
		subscribe(send) {
			subscribers.add(send);
			return () => {
				subscribers.delete(send);
			};
		},
	};
}
