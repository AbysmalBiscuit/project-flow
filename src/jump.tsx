import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { TicketPanel } from "./panel.tsx";
import {
	activeTicket,
	closeTicket,
	type OpenedTicket,
	openTicket,
	replaceActiveItem,
	useActiveTicket,
} from "./selection.ts";
import { stateLabel } from "./terms.ts";
import { sameTicketKey, type TicketSearchHit } from "./ticket-key.ts";
import { clsx } from "./ui.ts";
import { jump } from "./ui-styles.ts";

const listeners = new Set<() => void>();

function currentRoute(): string {
	return `${window.location.pathname}${window.location.search}`;
}

function subscribeRoute(listener: () => void): () => void {
	window.addEventListener("popstate", listener);
	return () => window.removeEventListener("popstate", listener);
}

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
	const [needs, setNeeds] = useState<NeedsYouItem[]>([]);
	const needsRef = useRef(needs);
	needsRef.current = needs;
	const pendingItem = useRef<OpenedTicket | null>(null);
	const ticket = useActiveTicket();
	const route = useSyncExternalStore(
		subscribeRoute,
		currentRoute,
		currentRoute,
	);
	const opened = useRef<OpenedTicket | null>(null);
	const queryRef = useRef<HTMLInputElement>(null);
	const returnFocus = useRef<HTMLElement | null>(null);
	const openRef = useRef(false);
	const closeSearch = useCallback(() => {
		setOpen(false);
		openRef.current = false;
		const target = returnFocus.current;
		returnFocus.current = null;
		queueMicrotask(() => {
			if (target?.isConnected === true) {
				target.focus();
			}
		});
	}, []);
	useEffect(
		() =>
			onOpenJumpBox(() => {
				if (openRef.current) {
					return;
				}
				const active = document.activeElement;
				const insideSearch =
					active instanceof HTMLElement &&
					active.closest("[role='dialog']") !== null;
				returnFocus.current =
					active instanceof HTMLElement && !insideSearch ? active : null;
				openRef.current = true;
				setOpen(true);
			}),
		[],
	);
	useEffect(() => {
		if (open) {
			queryRef.current?.focus();
		}
	}, [open]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				openJumpBox();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	useEffect(() => {
		if (!open) {
			return;
		}
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			closeSearch();
		};
		window.addEventListener("keydown", onEscape);
		return () => window.removeEventListener("keydown", onEscape);
	}, [open, closeSearch]);
	const applyNeeds = useCallback((loaded: NeedsYouItem[]) => {
		needsRef.current = loaded;
		setNeeds(loaded);
		const pending = pendingItem.current;
		if (pending === null) {
			return;
		}
		const selected = activeTicket();
		if (
			selected === null ||
			selected.tracker !== pending.tracker ||
			selected.project !== pending.project ||
			!sameTicketKey(selected.key, pending.key)
		) {
			pendingItem.current = null;
			return;
		}
		const item = loaded.find(
			(candidate) =>
				candidate.tracker === pending.tracker &&
				candidate.project === pending.project &&
				sameTicketKey(candidate.key, pending.key),
		);
		if (item !== undefined) {
			replaceActiveItem(item);
			pendingItem.current = null;
		}
	}, []);
	const loadNeeds = useCallback(() => {
		fetch("/api/needs-you")
			.then(async (response) => {
				if (!response.ok) {
					return;
				}
				applyNeeds((await response.json()) as NeedsYouItem[]);
			})
			.catch(() => {});
	}, [applyNeeds]);
	useEffect(() => {
		loadNeeds();
		return onAppEvent("overview", () => {
			loadNeeds();
		});
	}, [loadNeeds]);
	if (ticket === null) {
		if (opened.current !== null) {
			pendingItem.current = null;
			opened.current = null;
		}
	} else if (
		opened.current === null ||
		opened.current.tracker !== ticket.tracker ||
		opened.current.project !== ticket.project ||
		!sameTicketKey(opened.current.key, ticket.key)
	) {
		if (opened.current !== null) {
			pendingItem.current = null;
		}
		opened.current = {
			project: ticket.project,
			tracker: ticket.tracker,
			key: ticket.key,
		};
	}
	useEffect(() => {
		if (open) {
			loadNeeds();
		}
	}, [open, loadNeeds]);
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
	const needsItem = (hit: {
		tracker: NeedsYouItem["tracker"];
		project: string;
		key: string;
	}): NeedsYouItem | undefined =>
		needsRef.current.find(
			(item) =>
				item.tracker === hit.tracker &&
				item.project === hit.project &&
				sameTicketKey(item.key, hit.key),
		);
	const path = new URL(route, window.location.href).pathname;
	const pageRendersPanel =
		path === "/needs-you" || path === "/inbox" || path.startsWith("/projects/");
	if (!open && (ticket === null || pageRendersPanel)) {
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
											const item = needsItem(hit);
											openTicket({
												project: hit.project,
												tracker: hit.tracker,
												key: hit.key,
												...(item === undefined ? {} : { item }),
											});
											pendingItem.current =
												item === undefined
													? {
															project: hit.project,
															tracker: hit.tracker,
															key: hit.key,
														}
													: null;
											closeSearch();
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
			{ticket === null || pageRendersPanel ? null : (
				<div className={clsx(jump.dock)}>
					<TicketPanel
						key={`${ticket.tracker} ${ticket.project} ${ticket.key}`}
						tracker={ticket.tracker}
						project={ticket.project}
						ticketKey={ticket.key}
						item={needsItem(ticket) ?? null}
						onClose={closeTicket}
					/>
				</div>
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
