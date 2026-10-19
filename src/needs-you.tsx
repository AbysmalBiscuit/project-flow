import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { NeedsItem } from "./needs-item.tsx";
import { TicketPanel } from "./panel.tsx";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { needs, shell } from "./ui-styles.ts";

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
		<main className={clsx(shell.page)}>
			<p className={clsx(shell.nav)}>
				<a className={clsx(shell.link, shell.linkFocus)} href="/">
					{navLabel.projects}
				</a>
				<a className={clsx(shell.link, shell.linkFocus)} href="/inbox">
					{navLabel.inbox}
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
			<h1 className={clsx(shell.title)}>{navLabel.needsYou}</h1>
			<ul className={clsx(needs.list)}>
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
		return <main className={clsx(shell.page)}>Loading needs you</main>;
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
