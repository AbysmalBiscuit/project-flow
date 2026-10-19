import type { Notification as InboxNotification } from "./domain.ts";
import { onAppEvent } from "./events.ts";

export const triggerLabel: Record<InboxNotification["trigger"], string> = {
	needsYou: "Needs you",
	comment: "New comment",
	blockerCleared: "Blocker cleared",
};

function showNotification(event: MessageEvent): void {
	const notification = JSON.parse(event.data) as InboxNotification;
	const title = triggerLabel[notification.trigger];
	const body = `${notification.project}: ${notification.text}`;
	if (Notification.permission !== "granted") {
		return;
	}
	new Notification(title, { body, tag: notification.id });
}

export function watchNotifications(): () => void {
	if (typeof Notification === "undefined") {
		return () => {};
	}
	return onAppEvent("notification", showNotification);
}

export function askNotificationPermission(): void {
	if (
		typeof Notification === "undefined" ||
		Notification.permission !== "default"
	) {
		return;
	}
	void Notification.requestPermission();
}
