import { useEffect, useRef, useState } from "react";
import type { NeedsYouItem } from "./domain.ts";
import { Dropdown } from "./dropdown.tsx";
import { onAppEvent } from "./events.ts";
import { NeedsItem } from "./needs-item.tsx";
import { mountPage, readPageCache, writePageCache } from "./page-cache.ts";
import { TicketPanel } from "./panel.tsx";
import {
	activeTicket,
	closeTicket,
	type OpenedTicket,
	openTicket,
	replaceActiveItem,
	useActiveTicket,
} from "./selection.ts";
import { PageFrame, PollStatus } from "./shell.tsx";
import {
	loadingLabel,
	type NeedsGroup,
	navLabel,
	needsGroupLabel,
	polledAgo,
	reasonLabel,
	reasonOrder,
	reasonTab,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { needs } from "./ui-styles.ts";

const allReasons = "all";
const allProjects = "all";

type ReasonFilter = NeedsYouItem["reason"] | typeof allReasons;

function NeedsTabs({
	items,
	reason,
	onReason,
}: {
	items: NeedsYouItem[];
	reason: ReasonFilter;
	onReason: (reason: ReasonFilter) => void;
}) {
	const tabs: readonly { id: ReasonFilter; label: string }[] = [
		{ id: allReasons, label: "All" },
		...reasonOrder
			.filter((id) => id !== "runFailed")
			.map((id) => ({ id, label: reasonTab[id] })),
	];
	return (
		<div className={clsx(needs.tabs)} role="tablist" aria-label="Reason">
			{tabs.map((tab) => {
				const count =
					tab.id === allReasons
						? items.length
						: items.filter((item) => item.reason === tab.id).length;
				return (
					<button
						key={tab.id}
						type="button"
						id={`reason-${tab.id}`}
						role="tab"
						className={clsx(needs.tab, reason === tab.id && needs.tabOn)}
						aria-selected={reason === tab.id}
						onClick={() => onReason(tab.id)}
					>
						{tab.label} {count}
					</button>
				);
			})}
		</div>
	);
}

function groupName(group: NeedsGroup, item: NeedsYouItem): string {
	if (group === "project") {
		return item.project;
	}
	if (group === "reason") {
		return reasonLabel[item.reason];
	}
	return "";
}

function trackerName(tracker: NeedsYouItem["tracker"]): string {
	return tracker === "linear" ? "Linear" : "GitHub";
}

function NeedsGroups({
	items,
	group,
	selected,
	onOpen,
}: {
	items: NeedsYouItem[];
	group: NeedsGroup;
	selected: string | null;
	onOpen: (item: NeedsYouItem) => void;
}) {
	if (items.length === 0) {
		return <p className={clsx(needs.empty)}>Nothing needs you</p>;
	}
	const names =
		group === "none"
			? [""]
			: [...new Set(items.map((item) => groupName(group, item)))];
	return (
		<div className={clsx(needs.card)}>
			{names.map((name, index) => {
				const grouped =
					group === "none"
						? items
						: items.filter((item) => groupName(group, item) === name);
				const sample = grouped[0];
				return (
					<section
						key={name || "none"}
						className={clsx(needs.group, index === 0 && needs.groupFirst)}
					>
						{group === "none" || sample === undefined ? null : (
							<h2 className={clsx(needs.groupTitle)}>
								{name}
								{group === "project" ? (
									<span className={clsx(needs.tracker)}>
										{trackerName(sample.tracker)} {grouped.length}
									</span>
								) : (
									<span className={clsx(needs.tracker)}>{grouped.length}</span>
								)}
							</h2>
						)}
						<ul className={clsx(needs.list)}>
							{grouped.map((item) => (
								<NeedsItem
									key={`${item.project} ${item.key}`}
									item={item}
									selected={selected === `${item.project} ${item.key}`}
									onOpen={() => onOpen(item)}
									onAction={() => onOpen(item)}
								/>
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

function NeedsPanel({
	items,
	ticket,
}: {
	items: NeedsYouItem[];
	ticket: OpenedTicket | null;
}) {
	if (ticket === null) {
		return null;
	}
	const item =
		ticket.item ??
		items.find(
			(candidate) =>
				candidate.project === ticket.project && candidate.key === ticket.key,
		);
	return (
		<TicketPanel
			key={`${ticket.tracker} ${ticket.project} ${ticket.key}`}
			tracker={ticket.tracker}
			project={ticket.project}
			ticketKey={ticket.key}
			{...(item === undefined ? {} : { title: item.headline, item })}
			onClose={closeTicket}
		/>
	);
}

function summaryLine(items: NeedsYouItem[]): string {
	const tickets =
		items.length === 1
			? "1 ticket needs you"
			: `${items.length} tickets need you`;
	const answered = items.filter((item) => item.answered).length;
	const clearing =
		answered === 0
			? ""
			: answered === 1
				? ", 1 answered question is clearing"
				: `, ${answered} answered questions are clearing`;
	return `${tickets}${clearing}`;
}

function NeedsList({
	items,
	fetchedAt,
	polling,
}: {
	items: NeedsYouItem[];
	fetchedAt: string | null;
	polling: boolean;
}) {
	const [reason, setReason] = useState<ReasonFilter>(allReasons);
	const [project, setProject] = useState(allProjects);
	const [group, setGroup] = useState<NeedsGroup>("project");
	const ticket = useActiveTicket();
	const seeded = useRef(false);
	const projects = [...new Set(items.map((item) => item.project))];
	const selected =
		project === allProjects || projects.includes(project)
			? project
			: allProjects;
	const inProject = items.filter(
		(item) => selected === allProjects || item.project === selected,
	);
	useEffect(() => {
		const first = items[0];
		if (seeded.current || first === undefined || activeTicket() !== null) {
			seeded.current = true;
			return;
		}
		seeded.current = true;
		openTicket({
			tracker: first.tracker,
			project: first.project,
			key: first.key,
		});
	}, [items]);
	const shown = inProject.filter(
		(item) => reason === allReasons || item.reason === reason,
	);
	const choose = (item: NeedsYouItem) => {
		openTicket({
			tracker: item.tracker,
			project: item.project,
			key: item.key,
			item,
		});
	};
	return (
		<PageFrame
			title={navLabel.needsYou}
			subtitle={
				<>
					{summaryLine(items)}
					{polling || fetchedAt !== null ? ", " : null}
					<PollStatus
						text={polling ? null : polledAgo(fetchedAt)}
						polling={polling}
					/>
				</>
			}
			wide
		>
			<div className={clsx(needs.layout)}>
				<div className={clsx(needs.main)}>
					<div className={clsx(needs.toolbar)}>
						<NeedsTabs items={inProject} reason={reason} onReason={setReason} />
						<Dropdown
							id="needs-project"
							label="Project"
							value={selected}
							choices={[
								{ id: allProjects, label: "All projects" },
								...projects.map((name) => ({ id: name, label: name })),
							]}
							onChange={setProject}
						/>
						<Dropdown
							id="needs-group"
							label="Group by"
							value={`Group by ${needsGroupLabel[group]}`}
							choices={(["none", "project", "reason"] as const).map((id) => ({
								id: `Group by ${needsGroupLabel[id]}`,
								label: `Group by ${needsGroupLabel[id]}`,
							}))}
							onChange={(label) => {
								for (const id of ["project", "reason", "none"] as const) {
									if (`Group by ${needsGroupLabel[id]}` === label) {
										setGroup(id);
									}
								}
							}}
						/>
					</div>
					<p className={clsx(needs.shown)} data-needs-shown={shown.length}>
						Showing {shown.length}
					</p>
					<NeedsGroups
						items={shown}
						group={group}
						selected={
							ticket === null ? null : `${ticket.project} ${ticket.key}`
						}
						onOpen={choose}
					/>
				</div>
				<NeedsPanel items={items} ticket={ticket} />
			</div>
		</PageFrame>
	);
}

function Page() {
	const [items, setItems] = useState<NeedsYouItem[] | null>(
		() => readPageCache("needs-you") ?? null,
	);
	const [fetchedAt, setFetchedAt] = useState<string | null>(
		() => readPageCache("fetched-at") ?? null,
	);
	const [polling, setPolling] = useState(
		() => readPageCache("polling") !== false,
	);
	useEffect(() => {
		let stopped = false;
		const load = () => {
			fetch("/api/needs-you")
				.then(async (response) => {
					if (!stopped && response.ok) {
						const loaded = (await response.json()) as NeedsYouItem[];
						writePageCache("needs-you", loaded);
						setItems(loaded);
						for (const item of loaded) {
							replaceActiveItem(item);
						}
					}
				})
				.catch(() => {
					if (!stopped) {
						setItems([]);
					}
				});
			fetch("/api/overview")
				.then(async (response) => {
					if (!stopped && response.ok) {
						const body = (await response.json()) as {
							fetchedAt: string | null;
							polling?: true;
						};
						const next = body.polling === true;
						writePageCache("polling", next);
						setPolling(next);
						writePageCache("fetched-at", body.fetchedAt);
						setFetchedAt(body.fetchedAt);
					}
				})
				.catch(() => {
					if (!stopped) {
						setPolling(false);
						writePageCache("fetched-at", null);
						setFetchedAt(null);
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
		return <PageFrame title={navLabel.needsYou}>{loadingLabel}</PageFrame>;
	}
	return <NeedsList items={items} fetchedAt={fetchedAt} polling={polling} />;
}

function mount(): void {
	if (window.location.pathname !== "/needs-you") {
		return;
	}
	mountPage((root) => {
		root.render(<Page />);
	});
}

if (typeof document !== "undefined") {
	window.addEventListener("project-flow-page", mount);
	mount();
}
