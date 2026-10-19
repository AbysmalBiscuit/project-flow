import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { NeedsItem } from "./needs-item.tsx";
import { TicketPanel } from "./panel.tsx";
import { PageFrame } from "./shell.tsx";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { needs } from "./ui-styles.ts";

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
		<PageFrame title={navLabel.needsYou}>
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
		</PageFrame>
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
		return <PageFrame title={navLabel.needsYou}>Loading needs you</PageFrame>;
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
