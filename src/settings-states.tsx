import { useState } from "react";

import { Button } from "./button.tsx";
import { ColourPicker } from "./colour-picker.tsx";
import type { Configuration, UserState } from "./configuration.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { type StatusType, statusTypes } from "./kinds.ts";
import { Select } from "./select.tsx";
import { SettingsDialog } from "./settings-dialog.tsx";
import { Switch } from "./settings-parts.tsx";
import { settings as fields } from "./settings-styles.ts";
import { settingsCopy, settingsSection } from "./settings-terms.ts";
import { stateLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { stateValues } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

type StatesDraft = Pick<Configuration, "states" | "stateMappings">;

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
	onEditCategories,
}: {
	state: UserState;
	index: number;
	draft: StatesDraft;
	onChange: (next: Partial<StatesDraft>) => void;
	onEditCategories: () => void;
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
		<div className={clsx(fields.stateRow)} data-state-row={state.id}>
			<span className={clsx(fields.lane)}>
				<ColourPicker
					id={`colour-${state.id}`}
					label={state.label}
					value={state.colour}
					onChange={(colour) => patch({ colour })}
				/>
				<TextInput
					id={`state-label-${state.id}`}
					width={fields.stateName}
					aria-label={settingsCopy.stateName}
					value={state.label}
					onChange={(event) => patch({ label: event.target.value })}
				/>
			</span>
			<span>
				<Button
					id={`state-categories-${state.id}`}
					icon="pencil"
					iconSide="right"
					label={
						state.categories.length === 0
							? settingsCopy.holdsNothing
							: state.categories
									.map((category) => stateLabel[category])
									.join(", ")
					}
					name={settingsCopy.holdsOf(state.label)}
					onClick={onEditCategories}
				/>
			</span>
			<div className={clsx(fields.chips)}>
				<Button
					id={`state-up-${state.id}`}
					icon="arrow-up"
					name={`${settingsCopy.moveUp} ${state.label}`}
					disabled={index === 0}
					onClick={() =>
						onChange({ states: moved(draft.states, index, index - 1) })
					}
				/>
				<Button
					id={`state-down-${state.id}`}
					icon="arrow-down"
					name={`${settingsCopy.moveDown} ${state.label}`}
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
						icon="trash"
						name={`${settingsCopy.remove} ${state.label}`}
						disabled={others.length === 0}
						onClick={() => setRemoving(true)}
					/>
				)}
			</div>
		</div>
	);
}

export function StatesSection({
	draft,
	onChange,
	onReset,
}: {
	draft: StatesDraft;
	onChange: (next: Partial<StatesDraft>) => void;
	onReset: () => void;
}) {
	const [asking, setAsking] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const edited = draft.states.find((state) => state.id === editing);
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
			<div className={clsx(fields.stateRow, fields.stateHead)}>
				<span>{settingsCopy.state}</span>
				<span>{settingsCopy.holdsColumn}</span>
				<span />
			</div>
			{draft.states.map((state, index) => (
				<StateRow
					key={state.id}
					state={state}
					index={index}
					draft={draft}
					onChange={onChange}
					onEditCategories={() => setEditing(state.id)}
				/>
			))}
			{edited === undefined ? null : (
				<CategoriesDialog
					state={edited}
					states={draft.states}
					onChange={(categories) =>
						onChange({
							states: draft.states.map((item) =>
								item.id === edited.id ? { ...item, categories } : item,
							),
						})
					}
					onClose={() => setEditing(null)}
				/>
			)}
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

/** Picks the categories whose tickets a state holds when no state mapping names their status. */
function CategoriesDialog({
	state,
	states,
	onChange,
	onClose,
}: {
	state: UserState;
	states: readonly UserState[];
	onChange: (categories: StatusType[]) => void;
	onClose: () => void;
}) {
	return (
		<SettingsDialog
			id="state-categories-dialog"
			title={settingsCopy.holdsOf(state.label)}
			lead={settingsCopy.holdsLead}
			onClose={onClose}
		>
			{statusTypes.map((category) => {
				const on = state.categories.includes(category);
				const first = states.find((item) => item.categories.includes(category));
				const taken =
					on && first !== undefined && first.id !== state.id
						? first
						: undefined;
				return (
					<div key={category} className={clsx(fields.row)}>
						<div className={clsx(fields.rowText)}>
							<span className={clsx(fields.rowTitle)}>
								{stateLabel[category]}
							</span>
							<span className={clsx(fields.hint)}>
								{settingsCopy.categoryHint[category]}
							</span>
							{taken === undefined ? null : (
								<span className={clsx(fields.warning)}>
									{settingsCopy.heldAbove(taken.label)}
								</span>
							)}
						</div>
						<Switch
							id={`state-category-${state.id}-${category}`}
							checked={on}
							label={`${stateLabel[category]} ${state.label}`}
							onChange={(next) =>
								onChange(
									statusTypes.filter((item) =>
										item === category ? next : state.categories.includes(item),
									),
								)
							}
						/>
					</div>
				);
			})}
		</SettingsDialog>
	);
}
