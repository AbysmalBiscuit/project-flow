import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
import { Dropdown } from "./dropdown.tsx";
import { onAppEvent } from "./events.ts";
import { NeedsItem } from "./needs-item.tsx";
import { openTicket } from "./selection.ts";
import { PageFrame } from "./shell.tsx";
import {
	type NeedsGroup,
	navLabel,
	needsGroupLabel,
	reasonLabel,
	reasonOrder,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { needs, shell } from "./ui-styles.ts";

const allReasons = "all";
const allProjects = "all";

type ReasonFilter = NeedsYouItem["reason"] | typeof allReasons;

function PressedButton({
	id,
	pressed,
	onClick,
	children,
}: {
	id: string;
	pressed: boolean;
	onClick: () => void;
	children: string;
}) {
	return (
		<button
			type="button"
			id={id}
			className={clsx(
				shell.button,
				shell.buttonHover,
				shell.buttonFocus,
				pressed && shell.pressed,
			)}
			aria-pressed={pressed}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

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
		...reasonOrder.map((id) => ({ id, label: reasonLabel[id] })),
	];
	return (
		<div className={clsx(needs.tabList)}>
			{tabs.map((tab) => {
				const count =
					tab.id === allReasons
						? items.length
						: items.filter((item) => item.reason === tab.id).length;
				return (
					<PressedButton
						key={tab.id}
						id={`reason-${tab.id}`}
						pressed={reason === tab.id}
						onClick={() => onReason(tab.id)}
					>
						{`${tab.label} ${count}`}
					</PressedButton>
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

function NeedsGroups({
	items,
	group,
	onOpen,
}: {
	items: NeedsYouItem[];
	group: NeedsGroup;
	onOpen: (item: NeedsYouItem) => void;
}) {
	if (items.length === 0) {
		return <p>Nothing needs you</p>;
	}
	const names =
		group === "none"
			? [""]
			: [...new Set(items.map((item) => groupName(group, item)))];
	return (
		<>
			{names.map((name) => {
				const grouped =
					group === "none"
						? items
						: items.filter((item) => groupName(group, item) === name);
				return (
					<section key={name || "none"} className={clsx(needs.group)}>
						{group === "none" ? null : (
							<h2 className={clsx(needs.groupTitle)}>{name}</h2>
						)}
						<ul className={clsx(needs.list)}>
							{grouped.map((item) => (
								<NeedsItem
									key={`${item.project} ${item.key}`}
									item={item}
									project
									onOpen={() => onOpen(item)}
								/>
							))}
						</ul>
					</section>
				);
			})}
		</>
	);
}

function NeedsList({ items }: { items: NeedsYouItem[] }) {
	const [reason, setReason] = useState<ReasonFilter>(allReasons);
	const [project, setProject] = useState(allProjects);
	const [group, setGroup] = useState<NeedsGroup>("none");
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
	return (
		<PageFrame title={navLabel.needsYou}>
			<div className={clsx(needs.tabs)}>
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
			<p data-needs-shown={shown.length}>Showing {shown.length}</p>
			<NeedsGroups
				items={shown}
				group={group}
				onOpen={(item) =>
					openTicket({
						tracker: item.tracker,
						project: item.project,
						key: item.key,
					})
				}
			/>
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
