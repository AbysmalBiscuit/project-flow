import type { Notification as InboxNotification } from "./domain.ts";

const triggerLabel: Record<InboxNotification["trigger"], string> = {
	needsYou: "Needs you",
	comment: "New comment",
	blockerCleared: "Blocker cleared",
};

export function watchNotifications(): () => void {
	if (typeof Notification === "undefined") {
		return () => {};
	}
	const events = new EventSource("/api/events");
	if (Notification.permission === "default") {
		void Notification.requestPermission();
	}
	events.addEventListener("notification", (event) => {
		const notification = JSON.parse(event.data) as InboxNotification;
		const title = triggerLabel[notification.trigger];
		const body = `${notification.project}: ${notification.text}`;
		if (Notification.permission === "granted") {
			new Notification(title, { body, tag: notification.id });
			return;
		}
		const banner = document.createElement("p");
		banner.className = "browser-notification";
		banner.setAttribute("role", "status");
		banner.textContent = `${title}: ${body}`;
		document.body.prepend(banner);
	});
	return () => {
		events.close();
	};
}
