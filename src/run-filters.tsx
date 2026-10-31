import * as stylex from "@stylexjs/stylex";

import { board } from "./board-styles.ts";
import type { ProjectViewSettings } from "./configuration.ts";
import type { ProjectReport } from "./domain.ts";
import { runResults, runStatusKinds } from "./kinds.ts";
import { FilterMenu, type MenuProps } from "./project-filters.tsx";
import { runResultLabel, runsListCopy, runStatusLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

export function runFilterCount(view: ProjectViewSettings): number {
	return (
		(view.withRunsOnly ? 1 : 0) +
		(view.latestRunOnly ? 1 : 0) +
		view.runStatuses.length +
		view.runResults.length +
		view.runFactories.filter((name) => name.trim() !== "").length
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
			<label className={clsx(board.menuRow)}>
				<span>Latest run only</span>
				<input
					type="checkbox"
					className={clsx(board.check)}
					data-latest-run-only=""
					checked={view.latestRunOnly}
					onChange={(event) =>
						onChange({ ...view, latestRunOnly: event.target.checked })
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
