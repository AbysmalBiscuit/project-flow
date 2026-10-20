import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Notification } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { PageFrame } from "./shell.tsx";
import { navLabel, triggerLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { inbox } from "./ui-styles.ts";

function InboxList({ entries }: { entries: Notification[] }) {
	return (
		<PageFrame title={navLabel.inbox}>
			{entries.length === 0 ? <p>No notifications</p> : null}
			<ul className={clsx(inbox.list)}>
				{entries.map((entry) => (
					<li
						key={entry.id}
						className={clsx(inbox.entry)}
						data-trigger={entry.trigger}
					>
						<span className={clsx(inbox.trigger)}>
							{triggerLabel[entry.trigger]}
						</span>{" "}
						<span className={clsx(inbox.text)}>{entry.text}</span>
					</li>
				))}
			</ul>
		</PageFrame>
	);
}

function Page() {
	const [entries, setEntries] = useState<Notification[] | null>(null);
	useEffect(() => {
		let stopped = false;
		const load = () => {
			fetch("/api/inbox")
				.then(async (response) => {
					if (!stopped && response.ok) {
						setEntries((await response.json()) as Notification[]);
					}
				})
				.catch(() => {
					if (!stopped) {
						setEntries([]);
					}
				});
		};
		load();
		const stopOverview = onAppEvent("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			stopOverview();
		};
	}, []);
	if (entries === null) {
		return <PageFrame title={navLabel.inbox}>Loading inbox</PageFrame>;
	}
	return <InboxList entries={entries} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
