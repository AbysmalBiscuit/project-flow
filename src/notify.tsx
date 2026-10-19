import type { Notification as InboxNotification } from "./domain.ts";
import { onAppEvent } from "./events.ts";

const triggerLabel: Record<InboxNotification["trigger"], string> = {
	needsYou: "Needs you",
	comment: "New comment",
	blockerCleared: "Blocker cleared",
};

export function watchNotifications(): () => void {
	if (typeof Notification === "undefined") {
		return () => {};
	}
	if (Notification.permission === "default") {
		void Notification.requestPermission();
	}
	const stop = onAppEvent("notification", (event) => {
		const notification = JSON.parse(event.data) as InboxNotification;
		const title = triggerLabel[notification.trigger];
		const body = `${notification.project}: ${notification.text}`;
		if (Notification.permission === "granted") {
			new Notification(title, { body, tag: notification.id });
		}
	});
	return stop;
}
