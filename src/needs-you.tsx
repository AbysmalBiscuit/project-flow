import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
import { NeedsItem } from "./needs-item.tsx";

function NeedsList({ items }: { items: NeedsYouItem[] }) {
	return (
		<main className="needs-you-page">
			<p>
				<a className="back" href="/">
					Projects
				</a>
			</p>
			<h1>Needs you</h1>
			<ul className="needs-you-list">
				{items.map((item) => (
					<NeedsItem key={`${item.project} ${item.key}`} item={item} project />
				))}
			</ul>
		</main>
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
		const events = new EventSource("/api/events");
		events.addEventListener("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			events.close();
		};
	}, []);
	if (items === null) {
		return <main>Loading needs you</main>;
	}
	return <NeedsList items={items} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
