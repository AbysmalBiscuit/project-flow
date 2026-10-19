import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import styles from "./needs.module.css";
import { NeedsItem } from "./needs-item.tsx";
import { TicketPanel } from "./panel.tsx";
import shell from "./shell.module.css";

function NeedsList({
	items,
	opened,
	onOpen,
	onClose,
}: {
	items: NeedsYouItem[];
	opened: NeedsYouItem | null;
	onOpen: (item: NeedsYouItem) => void;
	onClose: () => void;
}) {
	return (
		<main className={shell.page}>
			<p className={shell.nav}>
				<a className={shell.link} href="/">
					Projects
				</a>
				<a className={shell.link} href="/inbox">
					Inbox
				</a>
				<button
					type="button"
					className={`${shell.button} ${shell.theme}`}
					data-theme-toggle=""
				>
					Dark mode
				</button>
			</p>
			<h1 className={shell.title}>Needs you</h1>
			<ul className={styles.list}>
				{items.map((item) => (
					<NeedsItem
						key={`${item.project} ${item.key}`}
						item={item}
						project
						onOpen={() => onOpen(item)}
					/>
				))}
			</ul>
			{opened === null ? null : (
				<TicketPanel
					tracker={opened.tracker}
					project={opened.project}
					ticketKey={opened.key}
					onClose={onClose}
				/>
			)}
		</main>
	);
}

function Page() {
	const [items, setItems] = useState<NeedsYouItem[] | null>(null);
	const [opened, setOpened] = useState<NeedsYouItem | null>(null);
	useEffect(() => {
		let stopped = false;
		const load = () => {
			fetch("/api/needs-you")
				.then(async (response) => {
					if (!stopped && response.ok) {
						setItems((await response.json()) as NeedsYouItem[]);
					}
				})
				.catch(() => {
					if (!stopped) {
						setItems([]);
					}
				});
		};
		load();
		const stop = onAppEvent("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			stop();
		};
	}, []);
	if (items === null) {
		return <main className={shell.page}>Loading needs you</main>;
	}
	return (
		<NeedsList
			items={items}
			opened={opened}
			onOpen={setOpened}
			onClose={() => setOpened(null)}
		/>
	);
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
