import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Notification } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import styles from "./inbox.module.css";
import { triggerLabel } from "./notify.tsx";
import shell from "./shell.module.css";

function InboxList({ entries }: { entries: Notification[] }) {
	return (
		<main className={shell.page}>
			<p className={shell.nav}>
				<a className={shell.link} href="/">
					Projects
				</a>
				<button
					type="button"
					className={`${shell.button} ${shell.theme}`}
					data-theme-toggle=""
				>
					Dark mode
				</button>
			</p>
			<h1 className={shell.title}>Inbox</h1>
			{entries.length === 0 ? <p>No notifications</p> : null}
			<ul className={styles.list}>
				{entries.map((entry) => (
					<li
						key={entry.id}
						className={styles.entry}
						data-trigger={entry.trigger}
					>
						<span className={styles.trigger}>
							{triggerLabel[entry.trigger]}
						</span>{" "}
						<span className={styles.text}>{entry.text}</span>
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
		return <main className={shell.page}>Loading inbox</main>;
	}
	return <InboxList entries={entries} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
