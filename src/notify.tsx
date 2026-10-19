import type { Notification as InboxNotification } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { triggerLabel } from "./terms.ts";

export { triggerLabel };

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

export function notificationPermission(): NotificationPermission | null {
	if (typeof Notification === "undefined") {
		return null;
	}
	return Notification.permission;
}

export function askNotificationPermission(): Promise<void> {
	if (notificationPermission() !== "default") {
		return Promise.resolve();
	}
	return Notification.requestPermission().then(() => undefined);
}
