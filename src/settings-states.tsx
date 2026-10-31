import { useState } from "react";

import { Button } from "./button.tsx";
import { Chip } from "./chip.tsx";
import { ColourPicker } from "./colour-picker.tsx";
import type { Configuration, UserState } from "./configuration.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { statusTypes } from "./kinds.ts";
import { Select } from "./select.tsx";
import { Row } from "./settings-parts.tsx";
import { settings as fields } from "./settings-styles.ts";
import type { StateSource } from "./settings-write.ts";
import { tonedProps } from "./state-tone.ts";
import { settingsCopy, settingsSection, stateLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { stateValues } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

type StatesDraft = Pick<Configuration, "states" | "stateMappings">;

const byCategory = "";

function newStateId(states: readonly UserState[]): string {
	const taken = new Set(states.map((state) => state.id));
	let count = 1;
	while (taken.has(`state-${count}`)) {
		count += 1;
	}
	return `state-${count}`;
}

function newStateLabel(states: readonly UserState[]): string {
	const taken = new Set(states.map((state) => state.label.toLowerCase()));
	let count = 1;
	while (taken.has(`${settingsCopy.newState} ${count}`.toLowerCase())) {
		count += 1;
	}
	return `${settingsCopy.newState} ${count}`;
}

function moved(
	states: readonly UserState[],
	from: number,
	to: number,
): UserState[] {
	const next = [...states];
	const [state] = next.splice(from, 1);
	if (state === undefined || to < 0 || to > next.length) {
		return [...states];
	}
	next.splice(to, 0, state);
	return next;
}

/**
 * Removes a state. The target state takes its categories, and every mapping
 * that named the removed state names the target, so its tickets move there.
 */
function removed(draft: StatesDraft, id: string, target: string): StatesDraft {
	const gone = draft.states.find((state) => state.id === id);
	const states = draft.states.flatMap((state) => {
		if (state.id === id) {
			return [];
		}
		if (state.id !== target || gone === undefined) {
			return [state];
		}
		const categories = statusTypes.filter(
			(category) =>
				state.categories.includes(category) ||
				gone.categories.includes(category),
		);
		return [{ ...state, categories }];
	});
	const stateMappings = Object.fromEntries(
		Object.entries(draft.stateMappings).map(([source, mapping]) => [
			source,
			Object.fromEntries(
				Object.entries(mapping).map(([name, mapped]) => [
					name,
					mapped === id ? target : mapped,
				]),
			),
		]),
	);
	return { states, stateMappings };
}

function StateRow({
	state,
	index,
	draft,
	onChange,
}: {
	state: UserState;
	index: number;
	draft: StatesDraft;
	onChange: (next: Partial<StatesDraft>) => void;
}) {
	const [removing, setRemoving] = useState(false);
	const others = draft.states.filter((item) => item.id !== state.id);
	const [target, setTarget] = useState(
		() =>
			others.find((item) =>
				item.categories.some((category) => state.categories.includes(category)),
			)?.id ??
			others[0]?.id ??
			"",
	);
	const patch = (next: Partial<UserState>) =>
		onChange({
			states: draft.states.map((item) =>
				item.id === state.id ? { ...item, ...next } : item,
			),
		});
	return (
		<div className={clsx(fields.row)} data-state-row={state.id}>
			<span className={clsx(fields.lane)}>
				<span {...tonedProps(state.colour, undefined, fields.dot)} />
				<TextInput
					id={`state-label-${state.id}`}
					width={fields.chipInput}
					aria-label={settingsCopy.stateName}
					value={state.label}
					onChange={(event) => patch({ label: event.target.value })}
				/>
				<ColourPicker
					id={`colour-${state.id}`}
					label={state.label}
					value={state.colour}
					onChange={(colour) => patch({ colour })}
				/>
			</span>
			<div className={clsx(fields.chips)}>
				{statusTypes.map((category) => {
					const on = state.categories.includes(category);
					return (
						<Button
							key={category}
							id={`state-${state.id}-${category}`}
							label={stateLabel[category]}
							pressed={on}
							onClick={() =>
								patch({
									categories: statusTypes.filter((item) =>
										item === category ? !on : state.categories.includes(item),
									),
								})
							}
						/>
					);
				})}
				<Button
					id={`state-up-${state.id}`}
					label={settingsCopy.moveUp}
					disabled={index === 0}
					onClick={() =>
						onChange({ states: moved(draft.states, index, index - 1) })
					}
				/>
				<Button
					id={`state-down-${state.id}`}
					label={settingsCopy.moveDown}
					disabled={index === draft.states.length - 1}
					onClick={() =>
						onChange({ states: moved(draft.states, index, index + 1) })
					}
				/>
				{removing ? (
					<>
						<Select
							id={`state-target-${state.id}`}
							aria-label={settingsCopy.moveTicketsTo}
							value={target}
							options={others.map((item) => ({
								value: item.id,
								label: `${settingsCopy.moveTicketsTo} ${item.label}`,
							}))}
							onChange={setTarget}
						/>
						<Button
							id={`state-remove-confirm-${state.id}`}
							label={settingsCopy.remove}
							tone="danger"
							onClick={() => onChange(removed(draft, state.id, target))}
						/>
						<Button
							id={`state-remove-cancel-${state.id}`}
							label={settingsCopy.cancel}
							onClick={() => setRemoving(false)}
						/>
					</>
				) : (
					<Button
						id={`state-remove-${state.id}`}
						label={settingsCopy.remove}
						disabled={others.length === 0}
						onClick={() => setRemoving(true)}
					/>
				)}
			</div>
		</div>
	);
}

function SourceMapping({
	source,
	draft,
	onChange,
}: {
	source: StateSource;
	draft: StatesDraft;
	onChange: (next: Partial<StatesDraft>) => void;
}) {
	const [label, setLabel] = useState("");
	const mapping = draft.stateMappings[source.key] ?? {};
	const options = [
		{ value: byCategory, label: settingsCopy.byCategory },
		...draft.states.map((state) => ({ value: state.id, label: state.label })),
	];
	const setMapped = (name: string, id: string) => {
		const next = { ...mapping };
		const known = Object.keys(next).find(
			(item) => item.toLowerCase() === name.toLowerCase(),
		);
		if (known !== undefined) {
			delete next[known];
		}
		if (id !== byCategory) {
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
	const mappedOf = (name: string) =>
		Object.entries(mapping).find(
			([item]) => item.toLowerCase() === name.toLowerCase(),
		)?.[1] ?? byCategory;
	const labels = Object.entries(mapping).filter(
		([name]) =>
			!source.statuses.some(
				(status) => status.toLowerCase() === name.toLowerCase(),
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
	return (
		<div data-state-source={source.key}>
			<h3 className={clsx(fields.rowTitle)}>
				{source.projects.includes(source.key)
					? source.projects.join(", ")
					: `${source.projects.join(", ")} (${source.key})`}
			</h3>
			{source.statuses.map((status) => (
				<Row key={status} title={status}>
					<Select
						id={`state-map-${source.key}-${status}`}
						aria-label={`${status} ${settingsCopy.mapsTo}`}
						value={mappedOf(status)}
						options={options}
						onChange={(id) => setMapped(status, id)}
					/>
				</Row>
			))}
			{labels.map(([name, id]) => (
				<Row key={name} title={`${settingsCopy.label} ${name}`}>
					<div className={clsx(fields.chips)}>
						<Select
							id={`state-map-${source.key}-label-${name}`}
							aria-label={`${name} ${settingsCopy.mapsTo}`}
							value={id}
							options={options}
							onChange={(next) => setMapped(name, next)}
						/>
						<Chip
							label={name}
							removeLabel={`${settingsCopy.remove} ${name}`}
							onRemove={() => setMapped(name, byCategory)}
						/>
					</div>
				</Row>
			))}
			<Row title={settingsCopy.mapLabel}>
				<div className={clsx(fields.chips)}>
					<TextInput
						id={`state-map-${source.key}-new-label`}
						width={fields.chipInput}
						aria-label={settingsCopy.label}
						placeholder={settingsCopy.label}
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
			</Row>
		</div>
	);
}

export function StatesSection({
	draft,
	sources,
	onChange,
	onReset,
}: {
	draft: StatesDraft;
	sources: readonly StateSource[];
	onChange: (next: Partial<StatesDraft>) => void;
	onReset: () => void;
}) {
	const [asking, setAsking] = useState(false);
	return (
		<section id="states" className={clsx(fields.card)}>
			<div className={clsx(fields.cardHead)}>
				<h2 className={clsx(fields.cardTitle)}>{settingsSection.states}</h2>
				<Button
					id="reset-states"
					label={settingsCopy.reset}
					onClick={() => setAsking(true)}
				/>
			</div>
			<p className={clsx(fields.hint)}>{settingsCopy.statesLead}</p>
			{draft.states.map((state, index) => (
				<StateRow
					key={state.id}
					state={state}
					index={index}
					draft={draft}
					onChange={onChange}
				/>
			))}
			<Button
				id="state-add"
				label={settingsCopy.addState}
				onClick={() =>
					onChange({
						states: [
							...draft.states,
							{
								id: newStateId(draft.states),
								label: newStateLabel(draft.states),
								colour: stateValues.backlog,
								categories: [],
							},
						],
					})
				}
			/>
			<h2 className={clsx(fields.cardTitle)}>{settingsCopy.stateMappings}</h2>
			<p className={clsx(fields.hint)}>{settingsCopy.stateMappingsLead}</p>
			{sources.map((source) => (
				<SourceMapping
					key={source.key}
					source={source}
					draft={draft}
					onChange={onChange}
				/>
			))}
			<ConfirmDialog
				id="reset-states-dialog"
				open={asking}
				title={settingsCopy.resetTitle}
				body={settingsCopy.resetBody}
				confirmLabel={settingsCopy.resetConfirm}
				onCancel={() => setAsking(false)}
				onConfirm={() => {
					setAsking(false);
					onReset();
				}}
			/>
		</section>
	);
}
