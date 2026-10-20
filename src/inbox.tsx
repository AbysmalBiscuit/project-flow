import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { InboxEntry, NotificationTrigger } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import {
	askNotificationPermission,
	notificationPermission,
} from "./notify.tsx";
import { TicketPanel } from "./panel.tsx";
import { closeTicket, openTicket, useActiveTicket } from "./selection.ts";
import { PageFrame } from "./shell.tsx";
import {
	inboxCopy,
	inboxFilterLabel,
	navLabel,
	triggerLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { frame, inbox, shell } from "./ui-styles.ts";

const filters = ["all", "needsYou", "comment", "blockerCleared"] as const;
type InboxFilter = (typeof filters)[number];
const dayOrder = ["today", "yesterday", "earlier"] as const;

const filterLabel: Record<InboxFilter, string> = {
	all: "All",
	needsYou: inboxFilterLabel.needsYou,
	comment: inboxFilterLabel.comment,
	blockerCleared: inboxFilterLabel.blockerCleared,
};

function clock(at: string): string {
	const stamp = new Date(at);
	if (Number.isNaN(stamp.getTime())) {
		return "";
	}
	return stamp.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
}

function Glyph({ children }: { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(frame.glyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{children}
		</svg>
	);
}

function BellIcon() {
	return (
		<Glyph>
			<path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
			<path d="M10 20a2 2 0 0 0 4 0" />
		</Glyph>
	);
}

function CheckIcon() {
	return (
		<Glyph>
			<path d="M5 12.5l4.5 4.5L19 7.5" />
		</Glyph>
	);
}

function TriggerIcon({ trigger }: { trigger: NotificationTrigger }) {
	if (trigger === "comment") {
		return (
			<Glyph>
				<path d="M5 6.5h14v8H8l-3 3z" />
			</Glyph>
		);
	}
	if (trigger === "blockerCleared") {
		return (
			<Glyph>
				<rect x="6" y="11" width="12" height="8" rx="1.5" />
				<path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0" />
			</Glyph>
		);
	}
	return (
		<Glyph>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 11v5" />
			<path d="M12 8h.01" />
		</Glyph>
	);
}

function asRead(entry: InboxEntry): InboxEntry {
	return { ...entry, read: true };
}

async function saveRead(path: string, body: string): Promise<boolean> {
	const response = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
	return response.ok;
}

function InboxList({
	entries,
	onChange,
}: {
	entries: InboxEntry[];
	onChange: (entries: InboxEntry[]) => void;
}) {
	const [filter, setFilter] = useState<InboxFilter>("all");
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [permission, setPermission] = useState(notificationPermission);
	const ticket = useActiveTicket();
	const unread = entries.filter((entry) => !entry.read).length;
	const shown = entries.filter(
		(entry) =>
			(filter === "all" || entry.trigger === filter) &&
			(!unreadOnly || !entry.read),
	);
	const groups = dayOrder.flatMap((name) => {
		const rows = shown.filter((entry) => entry.day === name);
		return rows.length === 0 ? [] : [{ name, rows }];
	});
	const applyRead = (
		next: InboxEntry[],
		path: string,
		body: string,
		previous: InboxEntry[],
	) => {
		onChange(next);
		void saveRead(path, body).then((saved) => {
			if (!saved) {
				onChange(previous);
			}
		});
	};
	const markOne = (id: string) => {
		applyRead(
			entries.map((entry) => (entry.id === id ? asRead(entry) : entry)),
			`/api/inbox/${encodeURIComponent(id)}`,
			JSON.stringify({ read: true }),
			entries,
		);
	};
	const markShown = () => {
		const ids = shown.map((entry) => entry.id);
		const markedIds = new Set(ids);
		applyRead(
			entries.map((entry) => (markedIds.has(entry.id) ? asRead(entry) : entry)),
			"/api/inbox",
			JSON.stringify({ read: true, ids }),
			entries,
		);
	};
	return (
		<PageFrame title={navLabel.inbox} wide>
			<div className={clsx(inbox.lead)}>
				<p>{inboxCopy.lead}</p>
				<p data-unread-count={unread}>
					{unread} {inboxCopy.unread}
				</p>
			</div>
			{permission === "default" || permission === "denied" ? (
				<div className={clsx(inbox.banner)} data-notify-banner="">
					<p className={clsx(inbox.bannerText)}>
						<BellIcon />
						{permission === "denied" ? inboxCopy.denied : inboxCopy.banner}
					</p>
					<div className={clsx(inbox.bannerActions)}>
						{permission === "default" ? (
							<button
								type="button"
								className={clsx(inbox.allow, shell.buttonFocus)}
								onClick={() => {
									void askNotificationPermission().finally(() => {
										setPermission(notificationPermission());
									});
								}}
							>
								{inboxCopy.allow}
							</button>
						) : null}
						<button
							type="button"
							className={clsx(inbox.dismiss, shell.buttonFocus)}
							aria-label={inboxCopy.dismiss}
							onClick={() => setPermission("granted")}
						>
							×
						</button>
					</div>
				</div>
			) : null}
			<div className={clsx(inbox.toolbar)}>
				<div className={clsx(inbox.tabs)} role="tablist" aria-label="Filter">
					{filters.map((name) => (
						<button
							key={name}
							type="button"
							id={`inbox-filter-${name}`}
							role="tab"
							className={clsx(
								inbox.tab,
								shell.buttonFocus,
								filter === name && inbox.tabOn,
							)}
							aria-selected={filter === name}
							onClick={() => setFilter(name)}
						>
							{filterLabel[name]}
						</button>
					))}
				</div>
				<div className={clsx(inbox.actions)}>
					<label className={clsx(inbox.check)}>
						<input
							id="inbox-unread-only"
							type="checkbox"
							checked={unreadOnly}
							onChange={(event) => setUnreadOnly(event.currentTarget.checked)}
						/>
						{inboxCopy.unreadOnly}
					</label>
					<button
						type="button"
						id="inbox-mark-all"
						className={clsx(
							shell.button,
							shell.buttonHover,
							shell.buttonFocus,
							inbox.markAll,
						)}
						onClick={markShown}
					>
						<CheckIcon />
						{inboxCopy.markAll}
					</button>
				</div>
			</div>
			<div className={clsx(inbox.stage)}>
				<div className={clsx(inbox.list)}>
					{shown.length === 0 ? (
						<p className={clsx(inbox.empty)}>{inboxCopy.empty}</p>
					) : null}
					{groups.map((group) => (
						<section key={group.name}>
							<h2 className={clsx(inbox.day)}>{inboxCopy[group.name]}</h2>
							<ul className={clsx(inbox.group)}>
								{group.rows.map((entry) => (
									<li key={entry.id}>
										<button
											type="button"
											className={clsx(inbox.row, shell.buttonFocus)}
											data-inbox={entry.id}
											data-trigger={entry.trigger}
											data-read={entry.read ? "true" : "false"}
											onClick={() => {
												openTicket({
													project: entry.project,
													tracker: entry.tracker,
													key: entry.key,
												});
												if (!entry.read) {
													markOne(entry.id);
												}
											}}
										>
											<span
												className={clsx(inbox.dot, entry.read && inbox.dotRead)}
												aria-hidden="true"
											/>
											<TriggerIcon trigger={entry.trigger} />
											<span className={clsx(inbox.body)}>
												<span className={clsx(inbox.meta)}>
													{triggerLabel[entry.trigger]}
													{" / "}
													<span className={clsx(inbox.project)}>
														{entry.project}
													</span>
												</span>
												<span className={clsx(inbox.text)}>{entry.text}</span>
											</span>
											<span className={clsx(inbox.time)}>
												{clock(entry.at)}
											</span>
										</button>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
				{ticket === null ? null : (
					<TicketPanel
						key={`${ticket.tracker} ${ticket.project} ${ticket.key}`}
						tracker={ticket.tracker}
						project={ticket.project}
						ticketKey={ticket.key}
						onClose={closeTicket}
					/>
				)}
			</div>
		</PageFrame>
	);
}

function Page() {
	const [entries, setEntries] = useState<InboxEntry[] | null>(null);
	useEffect(() => {
		let stopped = false;
		const load = () => {
			fetch("/api/inbox")
				.then(async (response) => {
					if (!stopped && response.ok) {
						setEntries((await response.json()) as InboxEntry[]);
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
		return <PageFrame title={navLabel.inbox}>Loading inbox</PageFrame>;
	}
	return <InboxList entries={entries} onChange={setEntries} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
