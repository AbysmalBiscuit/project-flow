import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";

import { Button } from "./button.tsx";
import type { Configuration, UserState } from "./configuration.ts";
import type { StatusType } from "./kinds.ts";
import { stateOfTicket } from "./lanes.ts";
import { Select } from "./select.tsx";
import { SettingsDialog } from "./settings-dialog.tsx";
import { settings as fields } from "./settings-styles.ts";
import { settingsCopy } from "./settings-terms.ts";
import type { StateSource } from "./settings-write.ts";
import { tonedProps } from "./state-tone.ts";
import { TextInput } from "./text-input.tsx";
import { colours, measure, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

type MappingDraft = Pick<Configuration, "states" | "stateMappings">;

const automatic = "";

const styles = stylex.create({
	shared: {
		margin: `0 0 ${space.md}`,
		color: colours.warnInk,
		fontSize: type.meta,
	},
	choice: {
		display: "flex",
		gap: space.sm,
		alignItems: "center",
	},
	grid: {
		display: "grid",
		gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
		gap: `${space.xs} ${space.md}`,
		alignItems: "center",
	},
	head: {
		color: colours.inkSoft,
		fontSize: type.meta,
		fontWeight: type.weight,
	},
	name: {
		overflowWrap: "anywhere",
	},
	add: {
		display: "flex",
		gap: space.sm,
		alignItems: "center",
		marginTop: space.md,
		paddingTop: space.md,
		borderTopWidth: measure.hairline,
		borderTopStyle: "solid",
		borderTopColor: colours.laneLine,
	},
});

function mappedKey(
	mapping: Record<string, string>,
	name: string,
): string | undefined {
	return Object.keys(mapping).find(
		(item) => item.toLowerCase() === name.toLowerCase(),
	);
}

/** Maps the tracker statuses and labels of one board, which can hold several projects, to states. */
export function StateMappingDialog({
	project,
	projectKey,
	source,
	draft,
	onChange,
	onClose,
}: {
	project: string;
	projectKey: string;
	source: StateSource;
	draft: MappingDraft;
	onChange: (next: Pick<Configuration, "stateMappings">) => void;
	onClose: () => void;
}) {
	const [label, setLabel] = useState("");

	const mapping = draft.stateMappings[source.key] ?? {};
	const stateOptions = draft.states.map((state) => ({
		value: state.id,
		label: state.label,
	}));
	const automaticState = (category: StatusType) =>
		stateOfTicket(draft.states, {}, [], category, category);
	const optionsFor = (category: StatusType) => [
		{
			value: automatic,
			label: settingsCopy.automatic(automaticState(category)?.label),
		},
		...stateOptions,
	];
	const stateOf = (id: string) => draft.states.find((state) => state.id === id);
	const setMapped = (name: string, id: string) => {
		const next = { ...mapping };
		const known = mappedKey(next, name);
		if (known !== undefined) {
			delete next[known];
		}
		if (id !== automatic) {
			next[name] = id;
		}
		const stateMappings = { ...draft.stateMappings };
		if (Object.keys(next).length === 0) {
			delete stateMappings[source.key];
		} else {
			stateMappings[source.key] = next;
		}
		onChange({ stateMappings });
	};
	const labels = Object.entries(mapping).filter(
		([name]) =>
			!source.statuses.some(
				(status) => status.name.toLowerCase() === name.toLowerCase(),
			),
	);
	const addLabel = () => {
		const name = label.trim();
		const first = draft.states[0];
		if (name === "" || first === undefined) {
			return;
		}
		setMapped(name, first.id);
		setLabel("");
	};
	const others = source.projects.filter(
		(name) =>
			name !== project && name.toLowerCase() !== projectKey.toLowerCase(),
	);
	return (
		<SettingsDialog
			id="state-mapping-dialog"
			title={settingsCopy.mapStatesOf(project)}
			lead={settingsCopy.stateMappingsLead}
			onClose={onClose}
		>
			{others.length === 0 ? null : (
				<p className={clsx(styles.shared)}>
					{settingsCopy.sharedBoard(others)}
				</p>
			)}
			{source.statuses.length === 0 && labels.length === 0 ? (
				<p className={clsx(fields.hint)}>{settingsCopy.noStatuses}</p>
			) : (
				<div className={clsx(styles.grid)}>
					<span className={clsx(styles.head)}>
						{settingsCopy.trackerStatus}
					</span>
					<span className={clsx(styles.head)}>{settingsCopy.state}</span>
					<span />
					{source.statuses.map(({ name, category }) => {
						const mapped = mapping[mappedKey(mapping, name) ?? ""];
						return (
							<MappingRow
								key={name}
								name={name}
								state={
									mapped === undefined
										? automaticState(category)
										: stateOf(mapped)
								}
							>
								<Select
									id={`state-map-${source.key}-${name}`}
									aria-label={`${name} ${settingsCopy.mapsTo}`}
									value={mapped ?? automatic}
									options={optionsFor(category)}
									onChange={(next) => setMapped(name, next)}
								/>
								<span />
							</MappingRow>
						);
					})}
					{labels.map(([name, mapped]) => (
						<MappingRow
							key={name}
							name={`${settingsCopy.label} ${name}`}
							state={stateOf(mapped)}
						>
							<Select
								id={`state-map-${source.key}-label-${name}`}
								aria-label={`${name} ${settingsCopy.mapsTo}`}
								value={mapped}
								options={stateOptions}
								onChange={(next) => setMapped(name, next)}
							/>
							<Button
								id={`state-map-${source.key}-remove-${name}`}
								icon="x"
								name={`${settingsCopy.remove} ${name}`}
								onClick={() => setMapped(name, automatic)}
							/>
						</MappingRow>
					))}
				</div>
			)}
			<div className={clsx(styles.add)}>
				<TextInput
					id={`state-map-${source.key}-new-label`}
					width={fields.chipInput}
					aria-label={settingsCopy.label}
					placeholder={settingsCopy.mapLabel}
					value={label}
					onKeyDown={(event) => {
						if (event.key !== "Enter") {
							return;
						}
						event.preventDefault();
						addLabel();
					}}
					onChange={(event) => setLabel(event.target.value)}
				/>
				<Button
					id={`state-map-${source.key}-add`}
					label={settingsCopy.add}
					onClick={addLabel}
				/>
			</div>
		</SettingsDialog>
	);
}

function MappingRow({
	name,
	state,
	children: [choice, action],
}: {
	name: string;
	state: UserState | undefined;
	children: [ReactNode, ReactNode];
}) {
	return (
		<>
			<span className={clsx(styles.name)}>{name}</span>
			<span className={clsx(styles.choice)}>
				{state === undefined ? null : (
					<span {...tonedProps(state.colour, undefined, fields.dot)} />
				)}
				{choice}
			</span>
			{action}
		</>
	);
}
