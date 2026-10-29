import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";

import { control } from "./control-styles.ts";
import { jump } from "./jump-styles.ts";
import { PageQueryRoot } from "./page-query.tsx";
import { TicketPanel } from "./panel.tsx";
import { closeTicket, openTicket, useActiveTicket } from "./selection.ts";
import { stateLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { ticketRefId, type TicketSearchHit } from "./ticket-key.ts";
import { phoneGutter } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

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
	const ticket = useActiveTicket();
	const route = useSyncExternalStore(
		subscribeRoute,
		currentRoute,
		currentRoute,
	);
	const queryRef = useRef<HTMLInputElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
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
			// Ctrl+Escape goes on to the focus mode listener as well.
			if (!event.ctrlKey && !event.metaKey) {
				event.stopPropagation();
			}
			closeSearch();
		};
		window.addEventListener("keydown", onEscape, true);
		return () => window.removeEventListener("keydown", onEscape, true);
	}, [open, closeSearch]);
	useEffect(() => {
		if (!open) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || boxRef.current?.contains(target)) {
				return;
			}
			closeSearch();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open, closeSearch]);
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
	const path = new URL(route, window.location.href).pathname;
	const pageRendersPanel =
		path === "/needs-you" || path === "/inbox" || path.startsWith("/projects/");
	if (!open && (ticket === null || pageRendersPanel)) {
		return null;
	}
	return (
		<>
			{open ? (
				<div className={clsx(jump.shade, phoneGutter.shade)} id="jump-shade">
					<div
						className={clsx(jump.box)}
						role="dialog"
						aria-label="Search tickets"
						ref={boxRef}
					>
						<TextInput
							id="jump-query"
							type="search"
							aria-label="Search tickets"
							placeholder="Search tickets"
							value={query}
							ref={queryRef}
							onChange={(event) => setQuery(event.target.value)}
						/>
						{query.trim() !== "" && hits.length === 0 ? (
							<p className={clsx(jump.empty)}>No tickets</p>
						) : null}
						<ul className={clsx(jump.list)}>
							{hits.map((hit) => (
								<li key={ticketRefId(hit)}>
									<button
										type="button"
										className={clsx(jump.hit, control.clear, control.focus)}
										data-ticket={hit.key}
										onClick={() => {
											openTicket({
												project: hit.project,
												tracker: hit.tracker,
												key: hit.key,
											});
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
				<div className={clsx(jump.dock)} data-panel-dock="">
					<TicketPanel
						key={ticketRefId(ticket)}
						ticket={ticket}
						onClose={closeTicket}
						dock
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
	createRoot(host).render(
		<PageQueryRoot>
			<JumpBox />
		</PageQueryRoot>,
	);
}
