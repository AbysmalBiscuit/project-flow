import type { InboxDay, InboxEntry, Notification } from "./domain.ts";

function calendarDay(stamp: Date): number {
	return Date.UTC(stamp.getFullYear(), stamp.getMonth(), stamp.getDate());
}

export function inboxEntries(entries: Notification[], now: Date): InboxEntry[] {
	const today = calendarDay(now);
	const yesterday = Date.UTC(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - 1,
	);
	return entries.map((entry) => {
		const stamp = new Date(entry.at);
		const day: InboxDay = Number.isNaN(stamp.getTime())
			? "earlier"
			: calendarDay(stamp) === today
				? "today"
				: calendarDay(stamp) === yesterday
					? "yesterday"
					: "earlier";
		return {
			...entry,
			day,
		};
	});
}
