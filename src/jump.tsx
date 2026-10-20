import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TicketSearchHit } from "./app.ts";
import { TicketPanel } from "./panel.tsx";
import { closeTicket, openTicket, useActiveTicket } from "./selection.ts";
import { stateLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { jump } from "./ui-styles.ts";

const listeners = new Set<() => void>();

export function openJumpBox(): void {
	for (const listener of listeners) {
		listener();
	}
}

function onOpenJumpBox(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function JumpBox() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<TicketSearchHit[]>([]);
	const ticket = useActiveTicket();
	const queryRef = useRef<HTMLInputElement>(null);
	useEffect(() => onOpenJumpBox(() => setOpen(true)), []);
	useEffect(() => {
		if (open) {
			queryRef.current?.focus();
		}
	}, [open]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	useEffect(() => {
		if (!open) {
			return;
		}
		const needle = query.trim();
		if (needle === "") {
			setHits([]);
			return;
		}
		let stopped = false;
		const handle = setTimeout(() => {
			fetch(`/api/search?q=${encodeURIComponent(needle)}`)
				.then(async (response) => {
					if (stopped || !response.ok) {
						return;
					}
					setHits((await response.json()) as TicketSearchHit[]);
				})
				.catch(() => {
					if (!stopped) {
						setHits([]);
					}
				});
		}, 0);
		return () => {
			stopped = true;
			clearTimeout(handle);
		};
	}, [open, query]);
	if (!open && ticket === null) {
		return null;
	}
	return (
		<>
			{open ? (
				<div className={clsx(jump.shade)}>
					<div
						className={clsx(jump.box)}
						role="dialog"
						aria-label="Search tickets"
					>
						<input
							className={clsx(jump.query)}
							id="jump-query"
							type="search"
							aria-label="Search tickets"
							placeholder="Search tickets"
							value={query}
							ref={queryRef}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									setOpen(false);
								}
							}}
						/>
						{query.trim() !== "" && hits.length === 0 ? (
							<p>No tickets</p>
						) : null}
						<ul className={clsx(jump.list)}>
							{hits.map((hit) => (
								<li key={`${hit.tracker} ${hit.project} ${hit.key}`}>
									<button
										type="button"
										className={clsx(jump.hit)}
										data-ticket={hit.key}
										onClick={() => {
											openTicket({
												project: hit.project,
												tracker: hit.tracker,
												key: hit.key,
											});
											setOpen(false);
										}}
									>
										<span>{hit.key}</span> <span>{hit.title}</span>{" "}
										<span>{stateLabel[hit.state]}</span>
									</button>
								</li>
							))}
						</ul>
					</div>
				</div>
			) : null}
			{ticket === null ||
			window.location.pathname.startsWith("/projects/") ? null : (
				<TicketPanel
					key={`${ticket.tracker} ${ticket.project} ${ticket.key}`}
					tracker={ticket.tracker}
					project={ticket.project}
					ticketKey={ticket.key}
					onClose={closeTicket}
				/>
			)}
		</>
	);
}

export function mountJumpBox(): void {
	const host = document.createElement("div");
	host.style.display = "contents";
	document.body.append(host);
	createRoot(host).render(<JumpBox />);
	const opener = document.createElement("button");
	opener.type = "button";
	opener.hidden = true;
	opener.id = "walk-ctrl-k";
	opener.addEventListener("click", () => {
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "k",
				code: "KeyK",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	document.body.append(opener);
}
