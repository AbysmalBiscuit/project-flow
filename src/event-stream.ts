import type { Change, Notifier } from "./ports.ts";

function encodeChange(
	encoder: TextEncoder,
	change: Change,
	notifications: boolean,
): Uint8Array[] {
	const frames = [
		encoder.encode(
			`event: ${change.viewsOnly === true ? "views" : "overview"}\ndata: ${JSON.stringify(change.overview)}\n\n`,
		),
	];
	if (change.progress !== undefined) {
		frames.push(
			encoder.encode(
				`event: progress\ndata: ${JSON.stringify(change.progress)}\n\n`,
			),
		);
	}
	if (notifications) {
		for (const notification of change.notifications) {
			frames.push(
				encoder.encode(
					`event: notification\ndata: ${JSON.stringify(notification)}\n\n`,
				),
			);
		}
	}
	return frames;
}

export function eventStream(
	notifier: Notifier,
	current: () => Change | null,
): Response {
	let unsubscribe = () => {};
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			controller.enqueue(encoder.encode(": open\n\n"));
			const open = current();
			if (open !== null) {
				for (const frame of encodeChange(encoder, open, false)) {
					controller.enqueue(frame);
				}
			}
			unsubscribe = notifier.subscribe((change) => {
				for (const frame of encodeChange(encoder, change, true)) {
					controller.enqueue(frame);
				}
			});
		},
		cancel() {
			unsubscribe();
		},
	});
	return new Response(body, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
	});
}
