import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Notification } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { triggerLabel } from "./notify.tsx";

function InboxList({ entries }: { entries: Notification[] }) {
	return (
		<main className="inbox-page">
			<p>
				<a className="back" href="/">
					Projects
				</a>
			</p>
			<h1>Inbox</h1>
			{entries.length === 0 ? <p>No notifications</p> : null}
			<ul className="inbox-list">
				{entries.map((entry) => (
					<li
						key={entry.id}
						className="inbox-entry"
						data-trigger={entry.trigger}
					>
						<span className="trigger">{triggerLabel[entry.trigger]}</span>{" "}
						<span className="text">{entry.text}</span>
					</li>
				))}
			</ul>
		</main>
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
		return <main>Loading inbox</main>;
	}
	return <InboxList entries={entries} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
