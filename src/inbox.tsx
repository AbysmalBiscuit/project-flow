import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Notification } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import {
	askNotificationPermission,
	notificationPermission,
} from "./notify.tsx";
import { TicketPanel } from "./panel.tsx";
import { PageFrame } from "./shell.tsx";
import {
	inboxCopy,
	inboxFilterLabel,
	navLabel,
	triggerLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { inbox, shell } from "./ui-styles.ts";

const filters = ["all", "needsYou", "comment", "blockerCleared"] as const;
type InboxFilter = (typeof filters)[number];
const dayOrder = ["today", "yesterday", "earlier"] as const;
type DayGroup = (typeof dayOrder)[number];

const filterLabel: Record<InboxFilter, string> = {
	all: "All",
	needsYou: inboxFilterLabel.needsYou,
	comment: inboxFilterLabel.comment,
	blockerCleared: inboxFilterLabel.blockerCleared,
};

function dayStart(stamp: Date): number {
	return new Date(
		stamp.getFullYear(),
		stamp.getMonth(),
		stamp.getDate(),
	).getTime();
}

function dayGroup(at: string, newest: Date): DayGroup {
	const stamp = new Date(at);
	if (Number.isNaN(stamp.getTime()) || Number.isNaN(newest.getTime())) {
		return "earlier";
	}
	const age = dayStart(newest) - dayStart(stamp);
	if (age <= 0) {
		return "today";
	}
	if (age <= 24 * 60 * 60 * 1000) {
		return "yesterday";
	}
	return "earlier";
}

function clock(at: string): string {
	const stamp = new Date(at);
	if (Number.isNaN(stamp.getTime())) {
		return "";
	}
	return stamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function trackerOf(key: string): "github" | "linear" {
	return key.includes("#") ? "github" : "linear";
}

function asRead(entry: Notification): Notification {
	return { ...entry, read: true };
}

function marked(entries: Notification[]): Notification[] {
	return entries.map(asRead);
}

const readBody = JSON.stringify({ read: true });

async function saveRead(id: string | null): Promise<boolean> {
	const path =
		id === null ? "/api/inbox" : `/api/inbox/${encodeURIComponent(id)}`;
	const response = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: readBody,
	});
	return response.ok;
}

function InboxList({
	entries,
	onChange,
}: {
	entries: Notification[];
	onChange: (entries: Notification[]) => void;
}) {
	const [filter, setFilter] = useState<InboxFilter>("all");
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const [permission, setPermission] = useState(notificationPermission);
	const unread = entries.filter((entry) => !entry.read).length;
	const shown = entries.filter(
		(entry) =>
			(filter === "all" || entry.trigger === filter) &&
			(!unreadOnly || !entry.read),
	);
	const open = entries.find((entry) => entry.id === openId) ?? null;
	const newestAt = entries.reduce(
		(latest, entry) => (entry.at > latest ? entry.at : latest),
		entries[0]?.at ?? "",
	);
	const groups = dayOrder.flatMap((name) => {
		const rows = shown.filter(
			(entry) => dayGroup(entry.at, new Date(newestAt)) === name,
		);
		return rows.length === 0 ? [] : [{ name, rows }];
	});
	const markOne = (id: string) => {
		const next = entries.map((entry) =>
			entry.id === id ? { ...entry, read: true } : entry,
		);
		onChange(next);
		void saveRead(id).then((saved) => {
			if (!saved) {
				onChange(entries);
			}
		});
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
						className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
						onClick={() => {
							const previous = entries;
							onChange(marked(previous));
							void saveRead(null).then((saved) => {
								if (!saved) {
									onChange(previous);
								}
							});
						}}
					>
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
												setOpenId(entry.id);
												if (!entry.read) {
													markOne(entry.id);
												}
											}}
										>
											<span
												className={clsx(inbox.dot, entry.read && inbox.dotRead)}
												aria-hidden="true"
											/>
											<span className={clsx(inbox.body)}>
												<span className={clsx(inbox.meta)}>
													{triggerLabel[entry.trigger]} / {entry.project}
												</span>
												<span
													className={clsx(
														inbox.text,
														entry.read && inbox.textRead,
													)}
												>
													{entry.text}
												</span>
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
				{open === null ? null : (
					<TicketPanel
						key={open.id}
						tracker={trackerOf(open.key)}
						project={open.project}
						ticketKey={open.key}
						onClose={() => setOpenId(null)}
					/>
				)}
			</div>
		</PageFrame>
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
		return <PageFrame title={navLabel.inbox}>Loading inbox</PageFrame>;
	}
	return <InboxList entries={entries} onChange={setEntries} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
