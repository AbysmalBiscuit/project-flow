import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "./button.tsx";
import { Chip } from "./chip.tsx";
import type { AutoMerge, Configuration } from "./configuration.ts";
import type { TicketState } from "./domain.ts";
import { Select } from "./select.tsx";
import { settings as fields } from "./settings-styles.ts";
import {
	settingsCopy,
	settingsSection,
	stateLabel,
	viewLabel,
} from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { clsx } from "./ui.ts";
import type { openViews } from "./view-settings.ts";

export type Trackers = { github: boolean; linear: boolean };

export const sections = [
	{ id: "general", label: settingsSection.general },
	{ id: "project-views", label: settingsSection.views },
	{ id: "colours", label: settingsSection.colours },
	{ id: "projects", label: settingsSection.projects },
	{ id: "review", label: settingsSection.review },
	{ id: "notifications", label: settingsSection.notifications },
	{ id: "trackers", label: settingsSection.trackers },
	{ id: "factories", label: settingsSection.factories },
] as const;

export const trackerFilters = ["all", "github", "linear"] as const;
export const stateFilters = ["all", "tracked"] as const;

export const laneStates = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
] as const satisfies readonly TicketState[];

export const ageChoices = [0, 2, 7, 14, 30] as const;

export const evidenceStates = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
	"dropped",
] as const satisfies readonly TicketState[];

export const autoMergeChoices = ["yes", "ask", "no"] as const;

export function ageLabel(days: number): string {
	if (days === 0) {
		return settingsCopy.anyAge;
	}
	return days === 1 ? "1 day" : `${days} days`;
}

export function Switch({
	id,
	checked,
	label,
	onChange,
}: {
	id: string;
	checked: boolean;
	label: string;
	onChange: (next: boolean) => void;
}) {
	return (
		<button
			id={id}
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			className={clsx(fields.switch, checked && fields.switchOn)}
			onClick={() => onChange(!checked)}
		>
			<span className={clsx(fields.knob, checked && fields.knobOn)} />
		</button>
	);
}

export function Row({
	title,
	hint,
	children,
}: {
	title: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className={clsx(fields.row)}>
			<div className={clsx(fields.rowText)}>
				<span className={clsx(fields.rowTitle)}>{title}</span>
				{hint === undefined ? null : (
					<span className={clsx(fields.hint)}>{hint}</span>
				)}
			</div>
			{children}
		</div>
	);
}

export function Chips({
	id,
	values,
	placeholder,
	onChange,
}: {
	id: string;
	values: string[];
	placeholder: string;
	onChange: (next: string[]) => void;
}) {
	const [text, setText] = useState("");
	function add(): void {
		const next = text.trim();
		if (next !== "" && !values.includes(next)) {
			onChange([...values, next]);
		}
		setText("");
	}
	return (
		<div className={clsx(fields.chips)}>
			{values.map((value) => (
				<Chip
					key={value}
					label={value}
					removeLabel={`Remove ${value}`}
					onRemove={() => onChange(values.filter((item) => item !== value))}
				/>
			))}
			<TextInput
				id={id}
				width={fields.chipInput}
				placeholder={placeholder}
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Enter") {
						return;
					}
					event.preventDefault();
					add();
				}}
			/>
			<Button id={`${id}-add`} label={settingsCopy.add} onClick={add} />
		</div>
	);
}

export function Credential({ id, present }: { id: string; present: boolean }) {
	return (
		<span id={id} className={clsx(fields.status, present && fields.statusOn)}>
			{present ? settingsCopy.connected : settingsCopy.missing}
		</span>
	);
}

export function MappingEditor({
	mappings,
	onChange,
}: {
	mappings: Configuration["laneMappings"];
	onChange: (next: Configuration["laneMappings"]) => void;
}) {
	const [key, setKey] = useState("");
	const [state, setState] =
		useState<(typeof evidenceStates)[number]>("awaitingMerge");
	const [status, setStatus] = useState("");
	const rows = Object.entries(mappings);
	function add(): void {
		const name = key.trim();
		const named = status.trim();
		if (name === "" || named === "") {
			return;
		}
		onChange({
			...mappings,
			[name]: { ...mappings[name], [state]: named },
		});
		setStatus("");
	}
	return (
		<div className={clsx(fields.chips)}>
			{rows.map(([name, mapping]) =>
				evidenceStates.flatMap((item) => {
					const value = mapping[item];
					return value === undefined
						? []
						: [
								<Chip
									key={`${name}-${item}`}
									label={`${name} ${stateLabel[item]} ${value}`}
									removeLabel={`Remove ${name} ${stateLabel[item]}`}
									onRemove={() => {
										const next = { ...mapping };
										delete next[item];
										const kept = { ...mappings };
										if (Object.keys(next).length === 0) {
											delete kept[name];
										} else {
											kept[name] = next;
										}
										onChange(kept);
									}}
								/>,
							];
				}),
			)}
			<TextInput
				id="lane-mapping-key"
				width={fields.chipInput}
				aria-label={settingsCopy.mappingKey}
				placeholder={settingsCopy.mappingKey}
				value={key}
				onChange={(event) => setKey(event.target.value)}
			/>
			<Select
				id="lane-mapping-state"
				aria-label={settingsCopy.laneState}
				value={state}
				options={evidenceStates.map((item) => ({
					value: item,
					label: stateLabel[item],
				}))}
				onChange={setState}
			/>
			<TextInput
				id="lane-mapping-status"
				width={fields.chipInput}
				aria-label={settingsCopy.statusName}
				placeholder={settingsCopy.statusName}
				value={status}
				onKeyDown={(event) => {
					if (event.key !== "Enter") {
						return;
					}
					event.preventDefault();
					add();
				}}
				onChange={(event) => setStatus(event.target.value)}
			/>
			<Button id="lane-mapping-add" label={settingsCopy.add} onClick={add} />
		</div>
	);
}

export const autoMergeLabel: Record<AutoMerge, string> = {
	yes: settingsCopy.yes,
	ask: settingsCopy.ask,
	no: settingsCopy.no,
};

export const openViewLabel: Record<(typeof openViews)[number], string> = {
	board: viewLabel.board,
	graph: viewLabel.graph,
	table: viewLabel.table,
	last: viewLabel.lastUsed,
};

export function AutoMergeEditor({
	overrides,
	onChange,
}: {
	overrides: Configuration["autoMerge"];
	onChange: (next: Configuration["autoMerge"]) => void;
}) {
	const [repo, setRepo] = useState("");
	const [choice, setChoice] = useState<AutoMerge>("ask");
	const rows = Object.entries(overrides);
	function add(): void {
		const name = repo.trim();
		if (name === "") {
			return;
		}
		onChange({ ...overrides, [name]: choice });
		setRepo("");
	}
	return (
		<div className={clsx(fields.chips)}>
			{rows.map(([name, value]) => (
				<Chip
					key={name}
					label={`${name} ${value}`}
					removeLabel={`Remove ${name}`}
					onRemove={() => {
						const next = { ...overrides };
						delete next[name];
						onChange(next);
					}}
				/>
			))}
			<TextInput
				id="auto-merge-repo"
				width={fields.chipInput}
				aria-label={settingsCopy.repo}
				placeholder={settingsCopy.repo}
				value={repo}
				onChange={(event) => setRepo(event.target.value)}
			/>
			<Select
				id="auto-merge-value"
				aria-label={settingsCopy.autoMerge}
				value={choice}
				options={autoMergeChoices.map((item) => ({
					value: item,
					label: autoMergeLabel[item],
				}))}
				onChange={setChoice}
			/>
			<Button id="auto-merge-add" label={settingsCopy.add} onClick={add} />
		</div>
	);
}
