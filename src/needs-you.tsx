import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
import { Dropdown } from "./dropdown.tsx";
import { onAppEvent } from "./events.ts";
import { NeedsItem } from "./needs-item.tsx";
import { TicketPanel } from "./panel.tsx";
import { closeTicket, openTicket } from "./selection.ts";
import { PageFrame } from "./shell.tsx";
import {
	type NeedsGroup,
	navLabel,
	needsGroupLabel,
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
		...reasonOrder.map((id) => ({ id, label: reasonTab[id] })),
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

function summaryLine(items: NeedsYouItem[], polled: string): string {
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
	return `${tickets}${clearing}${polled}`;
}

function NeedsList({
	items,
	polled,
}: {
	items: NeedsYouItem[];
	polled: string;
}) {
	const [reason, setReason] = useState<ReasonFilter>(allReasons);
	const [project, setProject] = useState(allProjects);
	const [group, setGroup] = useState<NeedsGroup>("project");
	const [open, setOpen] = useState<NeedsYouItem | null>(items[0] ?? null);
	const projects = [...new Set(items.map((item) => item.project))];
	const selected =
		project === allProjects || projects.includes(project)
			? project
			: allProjects;
	const inProject = items.filter(
		(item) => selected === allProjects || item.project === selected,
	);
	const shown = inProject.filter(
		(item) => reason === allReasons || item.reason === reason,
	);
	const choose = (item: NeedsYouItem) => {
		setOpen(item);
		openTicket({
			tracker: item.tracker,
			project: item.project,
			key: item.key,
		});
	};
	return (
		<PageFrame
			title={navLabel.needsYou}
			subtitle={summaryLine(items, polled)}
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
						selected={open === null ? null : `${open.project} ${open.key}`}
						onOpen={choose}
					/>
				</div>
				{open === null ? null : (
					<TicketPanel
						key={`${open.tracker} ${open.project} ${open.key}`}
						tracker={open.tracker}
						project={open.project}
						ticketKey={open.key}
						title={open.headline}
						why={`${reasonLabel[open.reason]}. ${open.headline}`}
						onClose={() => {
							setOpen(null);
							closeTicket();
						}}
					/>
				)}
			</div>
		</PageFrame>
	);
}

function ageLine(fetchedAt: string | null): string {
	if (fetchedAt === null) {
		return "";
	}
	const then = Date.parse(fetchedAt);
	if (Number.isNaN(then)) {
		return "";
	}
	const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
	if (seconds < 60) {
		return `, polled ${seconds} s ago`;
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `, polled ${minutes} min ago`;
	}
	return `, polled ${Math.round(minutes / 60)} h ago`;
}

function Page() {
	const [items, setItems] = useState<NeedsYouItem[] | null>(null);
	const [polled, setPolled] = useState("");
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
			fetch("/api/overview")
				.then(async (response) => {
					if (!stopped && response.ok) {
						const body = (await response.json()) as {
							fetchedAt: string | null;
						};
						setPolled(ageLine(body.fetchedAt));
					}
				})
				.catch(() => {
					if (!stopped) {
						setPolled("");
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
	return <NeedsList items={items} polled={polled} />;
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Page />);
}
