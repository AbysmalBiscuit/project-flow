import type { Change, Notifier } from "./ports.ts";

export function memoryNotifier(): Notifier {
	const subscribers = new Set<(change: Change) => void>();
	return {
		publish(change) {
			for (const send of subscribers) {
				send(change);
			}
		},
		subscribe(send) {
			subscribers.add(send);
			return () => {
				subscribers.delete(send);
			};
		},
	};
}
