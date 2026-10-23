import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "./button.tsx";
import type { AutoMerge, Configuration } from "./configuration.ts";
import type { TicketState } from "./domain.ts";
import { settings as fields } from "./settings-styles.ts";
import {
	settingsCopy,
	settingsSection,
	stateLabel,
	viewLabel,
} from "./terms.ts";
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
				<span key={value} className={clsx(fields.chip)}>
					{value}
					<button
						type="button"
						className={clsx(fields.chipRemove)}
						aria-label={`Remove ${value}`}
						onClick={() => onChange(values.filter((item) => item !== value))}
					>
						×
					</button>
				</span>
			))}
			<input
				id={id}
				className={clsx(fields.chipInput)}
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
								<span key={`${name}-${item}`} className={clsx(fields.chip)}>
									{name} {stateLabel[item]} {value}
									<button
										type="button"
										className={clsx(fields.chipRemove)}
										aria-label={`Remove ${name} ${stateLabel[item]}`}
										onClick={() => {
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
									>
										×
									</button>
								</span>,
							];
				}),
			)}
			<input
				id="lane-mapping-key"
				className={clsx(fields.chipInput)}
				aria-label={settingsCopy.mappingKey}
				placeholder={settingsCopy.mappingKey}
				value={key}
				onChange={(event) => setKey(event.target.value)}
			/>
			<select
				id="lane-mapping-state"
				className={clsx(fields.select)}
				aria-label={settingsCopy.laneState}
				value={state}
				onChange={(event) => {
					const next = evidenceStates.find(
						(item) => item === event.target.value,
					);
					if (next !== undefined) {
						setState(next);
					}
				}}
			>
				{evidenceStates.map((item) => (
					<option key={item} value={item}>
						{stateLabel[item]}
					</option>
				))}
			</select>
			<input
				id="lane-mapping-status"
				className={clsx(fields.chipInput)}
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
				<span key={name} className={clsx(fields.chip)}>
					{name} {value}
					<button
						type="button"
						className={clsx(fields.chipRemove)}
						aria-label={`Remove ${name}`}
						onClick={() => {
							const next = { ...overrides };
							delete next[name];
							onChange(next);
						}}
					>
						×
					</button>
				</span>
			))}
			<input
				id="auto-merge-repo"
				className={clsx(fields.chipInput)}
				aria-label={settingsCopy.repo}
				placeholder={settingsCopy.repo}
				value={repo}
				onChange={(event) => setRepo(event.target.value)}
			/>
			<select
				id="auto-merge-value"
				className={clsx(fields.select)}
				aria-label={settingsCopy.autoMerge}
				value={choice}
				onChange={(event) => {
					const next = autoMergeChoices.find(
						(item) => item === event.target.value,
					);
					if (next !== undefined) {
						setChoice(next);
					}
				}}
			>
				{autoMergeChoices.map((item) => (
					<option key={item} value={item}>
						{autoMergeLabel[item]}
					</option>
				))}
			</select>
			<Button id="auto-merge-add" label={settingsCopy.add} onClick={add} />
		</div>
	);
}

export function SearchGlyph() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(fields.filterGlyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="11" cy="11" r="6.5" />
			<path d="M16 16l4 4" />
		</svg>
	);
}

export function FilterGlyph() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(fields.filterGlyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5z" />
		</svg>
	);
}
