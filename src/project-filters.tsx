import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { board } from "./board-styles.ts";
import type { ProjectViewSettings } from "./configuration.ts";
import type { ProjectReport } from "./domain.ts";
import { clsx } from "./ui.ts";
import { frame, headerControlStyle, shell } from "./ui-styles.ts";
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

export function FilterMenu({
	report,
	view,
	open,
	onOpen,
	onChange,
}: {
	report: ProjectReport;
	view: ProjectViewSettings;
	open: boolean;
	onOpen: (next: boolean) => void;
	onChange: (next: ProjectViewSettings) => void;
}) {
	const root = useRef<HTMLDivElement>(null);
	const gutter = useRef<HTMLSpanElement>(null);
	const [shift, setShift] = useState(0);
	useLayoutEffect(() => {
		const node = root.current;
		if (!open || node === null) {
			return;
		}
		const place = () => {
			const panel = node.querySelector("#project-filter-menu");
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
	}, [open]);
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
			document.getElementById("project-filter")?.focus();
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, onOpen]);
	return (
		<div className={clsx(frame.menu)} ref={root}>
			<span
				ref={gutter}
				className={clsx(board.filterInset)}
				aria-hidden="true"
			/>
			<button
				type="button"
				id="project-filter"
				className={clsx(headerControlStyle.control, shell.buttonFocus)}
				aria-label="Filter"
				aria-expanded={open}
				aria-controls="project-filter-menu"
				onClick={() => onOpen(!open)}
			>
				<svg
					viewBox="0 0 16 16"
					aria-hidden="true"
					className={clsx(headerControlStyle.icon)}
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<path d="M2 3.5h12M4.5 8h7M7 12.5h2" />
				</svg>
				Filter
				<span className={clsx(headerControlStyle.count)}>
					{filterCount(view, report.lanes)}
				</span>
			</button>
			{open ? (
				<FilterPanel
					report={report}
					view={view}
					onChange={onChange}
					shift={shift}
				/>
			) : null}
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
				<label key={`${lane.id}-age`} className={clsx(board.menuRow)}>
					<span>{lane.name}</span>
					<input
						type="number"
						min={0}
						className={clsx(board.age)}
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
