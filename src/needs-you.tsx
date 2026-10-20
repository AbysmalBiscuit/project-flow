import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NeedsYouItem } from "./domain.ts";
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
import { frame, needs, shell } from "./ui-styles.ts";

const allReasons = "all";
const allProjects = "all";

function countLabel(label: string, count: number): string {
	return `${label} ${count}`;
}

function ChoiceButtons({
	id,
	label,
	value,
	choices,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	choices: readonly { id: string; label: string }[];
	onChange: (id: string) => void;
}) {
	return (
		<fieldset className={clsx(frame.views)} id={id}>
			<legend className={clsx(frame.legend)}>{label}</legend>
			{choices.map((choice) => {
				const pressed = value === choice.id;
				return (
					<button
						key={choice.id}
						type="button"
						id={`${id}-${choice.id}`}
						className={clsx(
							shell.button,
							shell.buttonHover,
							shell.buttonFocus,
							pressed && shell.pressed,
						)}
						aria-pressed={pressed}
						onClick={() => onChange(choice.id)}
					>
						{choice.label}
					</button>
				);
			})}
		</fieldset>
	);
}

function NeedsTabs({
	items,
	reason,
	onReason,
}: {
	items: NeedsYouItem[];
	reason: string;
	onReason: (reason: string) => void;
}) {
	const tabs = [
		{ id: allReasons, label: "All" },
		...reasonOrder.map((id) => ({ id, label: reasonLabel[id] })),
	];
	return (
		<div className={clsx(needs.tabs)}>
			{tabs.map((tab) => {
				const count =
					tab.id === allReasons
						? items.length
						: items.filter((item) => item.reason === tab.id).length;
				const pressed = reason === tab.id;
				return (
					<button
						key={tab.id}
						type="button"
						id={`reason-${tab.id}`}
						className={clsx(
							shell.button,
							shell.buttonHover,
							shell.buttonFocus,
							pressed && shell.pressed,
						)}
						aria-pressed={pressed}
						onClick={() => onReason(tab.id)}
					>
						{countLabel(tab.label, count)}
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
	const [reason, setReason] = useState(allReasons);
	const [project, setProject] = useState(allProjects);
	const [group, setGroup] = useState<NeedsGroup>("none");
	const projects = [...new Set(items.map((item) => item.project))];
	const projectChoices = projects.map((name, index) => ({
		id: `p${index + 1}`,
		label: name,
	}));
	const picked = projectChoices.find((choice) => choice.id === project);
	const shown = items.filter(
		(item) =>
			(reason === allReasons || item.reason === reason) &&
			(project === allProjects || item.project === picked?.label),
	);
	return (
		<PageFrame
			title={navLabel.needsYou}
			filter={
				<ChoiceButtons
					id="needs-project"
					label="Project"
					value={project}
					choices={[
						{ id: allProjects, label: "All projects" },
						...projectChoices,
					]}
					onChange={setProject}
				/>
			}
			sort={
				<ChoiceButtons
					id="needs-group"
					label="Group by"
					value={group}
					choices={(Object.keys(needsGroupLabel) as NeedsGroup[]).map((id) => ({
						id,
						label: needsGroupLabel[id],
					}))}
					onChange={(id) => setGroup(id as NeedsGroup)}
				/>
			}
		>
			<NeedsTabs items={items} reason={reason} onReason={setReason} />
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
