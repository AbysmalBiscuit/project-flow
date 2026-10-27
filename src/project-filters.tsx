import * as stylex from "@stylexjs/stylex";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { board } from "./board-styles.ts";
import { Button } from "./button.tsx";
import type { ProjectViewSettings } from "./configuration.ts";
import { type ProjectReport, runResults, runStatusKinds } from "./domain.ts";
import { runResultLabel, runsListCopy, runStatusLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { frame } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import { laneAgeCap, visibleLaneNames } from "./view-settings.ts";

function filterCount(
	view: ProjectViewSettings,
	lanes: ProjectReport["lanes"],
): number {
	const hidden =
		view.shownLanes === undefined
			? 0
			: lanes.length - visibleLaneNames(lanes, view.shownLanes).length;
	return (
		hidden +
		(view.needsYouOnly ? 1 : 0) +
		(view.blockedOnly ? 1 : 0) +
		view.assignees.filter((name) => name.trim() !== "").length
	);
}

function runFilterCount(view: ProjectViewSettings): number {
	return (
		(view.withRunsOnly ? 1 : 0) +
		view.runStatuses.length +
		view.runResults.length +
		view.runFactories.filter((name) => name.trim() !== "").length
	);
}

type MenuProps = {
	report: ProjectReport;
	view: ProjectViewSettings;
	open: boolean;
	onOpen: (next: boolean) => void;
	onChange: (next: ProjectViewSettings) => void;
};

export function TicketFilterMenu(props: MenuProps) {
	return (
		<FilterMenu
			id="project-filter"
			label="Ticket filter"
			count={filterCount(props.view, props.report.lanes)}
			open={props.open}
			onOpen={props.onOpen}
		>
			{(shift) => (
				<FilterPanel
					report={props.report}
					view={props.view}
					onChange={props.onChange}
					shift={shift}
				/>
			)}
		</FilterMenu>
	);
}

export function RunFilterMenu(props: MenuProps) {
	return (
		<FilterMenu
			id="project-run-filter"
			label="Run filter"
			count={runFilterCount(props.view)}
			open={props.open}
			onOpen={props.onOpen}
		>
			{(shift) => (
				<RunFilterPanel
					report={props.report}
					view={props.view}
					onChange={props.onChange}
					shift={shift}
				/>
			)}
		</FilterMenu>
	);
}

function FilterMenu({
	id,
	label,
	count,
	open,
	onOpen,
	children,
}: {
	id: string;
	label: string;
	count: number;
	open: boolean;
	onOpen: (next: boolean) => void;
	children: (shift: number) => ReactNode;
}) {
	const root = useRef<HTMLDivElement>(null);
	const gutter = useRef<HTMLSpanElement>(null);
	const [shift, setShift] = useState(0);
	const panelId = `${id}-menu`;
	useLayoutEffect(() => {
		const node = root.current;
		if (!open || node === null) {
			return;
		}
		const place = () => {
			const panel = node.querySelector(`#${panelId}`);
			if (!(panel instanceof HTMLElement)) {
				return;
			}
			const inset = gutter.current?.offsetWidth ?? 0;
			const box = panel.getBoundingClientRect();
			const applied = Number.parseFloat(getComputedStyle(panel).marginLeft);
			const unshiftedLeft = box.left - (Number.isFinite(applied) ? applied : 0);
			const unshiftedRight =
				box.right - (Number.isFinite(applied) ? applied : 0);
			const overflowRight = Math.ceil(
				unshiftedRight - (window.innerWidth - inset),
			);
			const overflowLeft = Math.ceil(inset - unshiftedLeft);
			setShift(
				overflowRight > 0
					? -overflowRight
					: overflowLeft > 0
						? overflowLeft
						: 0,
			);
		};
		place();
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("resize", place);
		};
	}, [open, panelId]);
	useEffect(() => {
		if (!open) {
			return;
		}
		const onPointer = (event: PointerEvent) => {
			const target = event.target;
			if (!root.current?.contains(target as Node)) {
				onOpen(false);
			}
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			event.preventDefault();
			onOpen(false);
			document.getElementById(id)?.focus();
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, onOpen, id]);
	return (
		<div className={clsx(frame.menu)} ref={root}>
			<span
				ref={gutter}
				className={clsx(board.filterInset)}
				aria-hidden="true"
			/>
			<Button
				id={id}
				icon="filter"
				label={label}
				count={count}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => onOpen(!open)}
			/>
			{open ? children(shift) : null}
		</div>
	);
}

function FilterPanel({
	report,
	view,
	onChange,
	shift,
}: {
	report: ProjectReport;
	view: ProjectViewSettings;
	onChange: (next: ProjectViewSettings) => void;
	shift: number;
}) {
	const shown = new Set(
		visibleLaneNames(report.lanes, view.shownLanes).map((name) =>
			name.toLowerCase(),
		),
	);
	const people = [
		...new Set(
			report.tickets.flatMap((ticket) =>
				(ticket.assignees ?? []).map((name) => name.trim()),
			),
		),
	].filter((name) => name !== "");
	const picked = new Set(view.assignees.map((name) => name.toLowerCase()));
	const [ageDraft, setAgeDraft] = useState<Record<string, string>>({});
	return (
		<div
			id="project-filter-menu"
			{...stylex.props(board.menu, shift === 0 ? null : board.shift(shift))}
		>
			<p className={clsx(board.menuLabel)}>Lanes</p>
			{report.lanes.map((lane) => (
				<label key={lane.id} className={clsx(board.menuRow)}>
					<span>{lane.name}</span>
					<input
						type="checkbox"
						className={clsx(board.check)}
						data-lane-toggle={lane.name}
						checked={shown.has(lane.name.toLowerCase())}
						onChange={(event) => {
							const names = report.lanes.flatMap((item) =>
								item.name.toLowerCase() === lane.name.toLowerCase()
									? event.target.checked
										? [item.name]
										: []
									: shown.has(item.name.toLowerCase())
										? [item.name]
										: [],
							);
							onChange({ ...view, shownLanes: names });
						}}
					/>
				</label>
			))}
			<p className={clsx(board.menuLabel)}>Max age</p>
			{report.lanes.map((lane) => (
				<label
					key={`${lane.id}-age`}
					className={clsx(board.menuRow)}
					htmlFor={`lane-age-${lane.id}`}
				>
					<span>{lane.name}</span>
					<TextInput
						id={`lane-age-${lane.id}`}
						type="number"
						min={0}
						width={board.age}
						aria-label={`${lane.name} max age`}
						data-lane-age={lane.name}
						value={
							ageDraft[lane.name] ??
							String(laneAgeCap(view.maxAgeDays, lane.name, lane.statusType))
						}
						placeholder={
							laneAgeCap(view.maxAgeDays, lane.name, lane.statusType) === 0
								? "unlimited"
								: undefined
						}
						onChange={(event) => {
							const raw = event.target.value;
							const days = Number(raw);
							if (!Number.isInteger(days) || days < 0) {
								setAgeDraft((current) => ({ ...current, [lane.name]: raw }));
								return;
							}
							setAgeDraft((current) => {
								const next = { ...current };
								delete next[lane.name];
								return next;
							});
							onChange({
								...view,
								maxAgeDays: { ...view.maxAgeDays, [lane.name]: days },
							});
						}}
					/>
				</label>
			))}
			<label className={clsx(board.menuRow)}>
				<span>Needs you only</span>
				<input
					type="checkbox"
					className={clsx(board.check)}
					data-needs-you-only=""
					checked={view.needsYouOnly}
					onChange={(event) =>
						onChange({ ...view, needsYouOnly: event.target.checked })
					}
				/>
			</label>
			<label className={clsx(board.menuRow)}>
				<span>Blocked only</span>
				<input
					type="checkbox"
					className={clsx(board.check)}
					data-blocked-only=""
					checked={view.blockedOnly}
					onChange={(event) =>
						onChange({ ...view, blockedOnly: event.target.checked })
					}
				/>
			</label>
			<p className={clsx(board.menuLabel)}>Assignees</p>
			{people.map((person) => (
				<label key={person} className={clsx(board.menuRow)}>
					<span>{person}</span>
					<input
						type="checkbox"
						className={clsx(board.check)}
						data-assignee={person}
						checked={picked.has(person.toLowerCase())}
						onChange={(event) => {
							const next = event.target.checked
								? [...view.assignees, person]
								: view.assignees.filter(
										(name) => name.toLowerCase() !== person.toLowerCase(),
									);
							onChange({ ...view, assignees: next });
						}}
					/>
				</label>
			))}
		</div>
	);
}

function toggled<Value extends string>(
	values: readonly Value[],
	value: Value,
	checked: boolean,
): Value[] {
	const rest = values.filter(
		(item) => item.toLowerCase() !== value.toLowerCase(),
	);
	return checked ? [...rest, value] : rest;
}

function RunFilterPanel({
	report,
	view,
	onChange,
	shift,
}: {
	report: ProjectReport;
	view: ProjectViewSettings;
	onChange: (next: ProjectViewSettings) => void;
	shift: number;
}) {
	const factories = [
		...new Map(
			[
				...report.tickets.flatMap((ticket) =>
					ticket.factoryRun === undefined
						? []
						: [
								ticket.factoryRun.factory,
								...(ticket.earlierFactoryRuns ?? []).map((run) => run.factory),
							],
				),
				...view.runFactories,
			]
				.map((name) => name.trim())
				.filter((name) => name !== "")
				.map((name) => [name.toLowerCase(), name]),
		).values(),
	];
	const pickedFactories = new Set(
		view.runFactories.map((name) => name.trim().toLowerCase()),
	);
	return (
		<div
			id="project-run-filter-menu"
			{...stylex.props(board.menu, shift === 0 ? null : board.shift(shift))}
		>
			<label className={clsx(board.menuRow)}>
				<span>With runs only</span>
				<input
					type="checkbox"
					className={clsx(board.check)}
					data-with-runs-only=""
					checked={view.withRunsOnly}
					onChange={(event) =>
						onChange({ ...view, withRunsOnly: event.target.checked })
					}
				/>
			</label>
			<p className={clsx(board.menuLabel)}>{runsListCopy.status}</p>
			{runStatusKinds.map((kind) => (
				<label key={kind} className={clsx(board.menuRow)}>
					<span>{runStatusLabel[kind]}</span>
					<input
						type="checkbox"
						className={clsx(board.check)}
						data-run-status-filter={kind}
						checked={view.runStatuses.includes(kind)}
						onChange={(event) =>
							onChange({
								...view,
								runStatuses: toggled(
									view.runStatuses,
									kind,
									event.target.checked,
								),
							})
						}
					/>
				</label>
			))}
			<p className={clsx(board.menuLabel)}>{runsListCopy.result}</p>
			{runResults.map((kind) => (
				<label key={kind} className={clsx(board.menuRow)}>
					<span>{runResultLabel[kind]}</span>
					<input
						type="checkbox"
						className={clsx(board.check)}
						data-run-result-filter={kind}
						checked={view.runResults.includes(kind)}
						onChange={(event) =>
							onChange({
								...view,
								runResults: toggled(
									view.runResults,
									kind,
									event.target.checked,
								),
							})
						}
					/>
				</label>
			))}
			<p className={clsx(board.menuLabel)}>{runsListCopy.factory}</p>
			{factories.map((factory) => (
				<label key={factory} className={clsx(board.menuRow)}>
					<span>{factory}</span>
					<input
						type="checkbox"
						className={clsx(board.check)}
						data-run-factory-filter={factory}
						checked={pickedFactories.has(factory.toLowerCase())}
						onChange={(event) =>
							onChange({
								...view,
								runFactories: toggled(
									view.runFactories,
									factory,
									event.target.checked,
								),
							})
						}
					/>
				</label>
			))}
		</div>
	);
}
