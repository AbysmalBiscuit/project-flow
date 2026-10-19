import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Notification } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { navLabel, triggerLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { inbox, shell } from "./ui-styles.ts";

function InboxList({ entries }: { entries: Notification[] }) {
	return (
		<main className={clsx(shell.page)}>
			<p className={clsx(shell.nav)}>
				<a className={clsx(shell.link, shell.linkFocus)} href="/">
					{navLabel.projects}
				</a>
				<button
					type="button"
					className={clsx(
						shell.button,
						shell.buttonHover,
						shell.buttonFocus,
						shell.theme,
					)}
					data-theme-toggle=""
				>
					Dark mode
				</button>
			</p>
			<h1 className={clsx(shell.title)}>{navLabel.inbox}</h1>
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
		return <main className={clsx(shell.page)}>Loading inbox</main>;
	}
	return <InboxList entries={entries} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
