import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { NeedsItem } from "./needs-item.tsx";
import { openTicket } from "./selection.ts";
import { PageFrame } from "./shell.tsx";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { needs } from "./ui-styles.ts";

function NeedsList({ items }: { items: NeedsYouItem[] }) {
	return (
		<PageFrame title={navLabel.needsYou}>
			<ul className={clsx(needs.list)}>
				{items.map((item) => (
					<NeedsItem
						key={`${item.project} ${item.key}`}
						item={item}
						project
						onOpen={() =>
							openTicket({
								tracker: item.tracker,
								project: item.project,
								key: item.key,
							})
						}
					/>
				))}
			</ul>
		</PageFrame>
	);
}

function Page() {
	const [items, setItems] = useState<NeedsYouItem[] | null>(null);
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
	return <NeedsList items={items} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
