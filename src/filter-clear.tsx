import { board } from "./board-styles.ts";
import { Button } from "./button.tsx";
import type { ProjectViewSettings } from "./configuration.ts";
import type { ProjectReport } from "./domain.ts";
import { filterCount } from "./project-filters.tsx";
import { runFilterCount } from "./run-filters.tsx";
import {
	filterEmptyLabel,
	type HidingFilter,
	hidingFilterIds,
	hidingFilterLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { clearedRunFilters, emptyMaxAgeDays } from "./view-settings.ts";

export function clearedView(
	view: ProjectViewSettings,
	lanes: ProjectReport["lanes"],
): ProjectViewSettings {
	return {
		...view,
		shownLanes: lanes.map((lane) => lane.name),
		maxAgeDays: emptyMaxAgeDays,
		needsYouOnly: false,
		blockedOnly: false,
		assignees: [],
		search: "",
		...clearedRunFilters,
	};
}

export function hidingFiltersOf(report: ProjectReport): HidingFilter[] {
	return (report.hiddenBy ?? []).filter((id) =>
		hidingFilterIds.some((known) => known === id),
	);
}

export function FilteredEmpty({
	names,
	onClear,
}: {
	names: readonly HidingFilter[];
	onClear: () => void;
}) {
	return (
		<div id="filters-hide-all" className={clsx(board.filteredEmpty)}>
			<p>
				{names.map((name) => hidingFilterLabel[name]).join(", ")}{" "}
				{names.length === 1 ? filterEmptyLabel.one : filterEmptyLabel.many}{" "}
				{filterEmptyLabel.every}
			</p>
			<Button
				id="clear-filters"
				label={filterEmptyLabel.clear}
				onClick={onClear}
			/>
		</div>
	);
}

export function ClearFiltersButton({
	report,
	view,
	onClear,
}: {
	report: ProjectReport;
	view: ProjectViewSettings;
	onClear: () => void;
}) {
	const set =
		filterCount(view, report.lanes) > 0 ||
		runFilterCount(view) > 0 ||
		view.search.trim() !== "";
	if (!set) {
		return null;
	}
	return (
		<Button
			id="project-clear-filters"
			icon="funnel-x"
			label={filterEmptyLabel.clear}
			onClick={onClear}
		/>
	);
}
