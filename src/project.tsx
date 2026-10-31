import { Segment } from "./segment.tsx";
import { TextInput } from "./text-input.tsx";
import "@xyflow/react/dist/style.css";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { Group } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { board } from "./board-styles.ts";
import type { ProjectViewSettings } from "./configuration.ts";
import type { ProjectReport } from "./domain.ts";
import { Dropdown } from "./dropdown.tsx";
import {
	clearedView,
	ClearFiltersButton,
	FilteredEmpty,
	hidingFiltersOf,
} from "./filter-clear.tsx";
import { focusChain } from "./focus-chain.ts";
import { ClearFocusButton } from "./focus-controls.tsx";
import { shownSeeds, useFocusView } from "./focus.ts";
import { graphEdges, projectNodeId } from "./graph-flow.ts";
import { openUnlinkedPr } from "./open-unlinked-pr.ts";
import { TicketPanel } from "./panel.tsx";
import { RefreshButton } from "./poll-freshness.tsx";
import {
	Board,
	boardGroupBy,
	type TicketFocus,
	TicketFocusContext,
} from "./project-board.tsx";
import { TicketFilterMenu } from "./project-filters.tsx";
import { ProjectGraph } from "./project-graph.tsx";
import { TicketTable } from "./project-table.tsx";
import { ProjectWaiting } from "./project-waiting.tsx";
import { pageQuery, useRefreshProject, useSaveSettings } from "./queries.ts";
import { filterProjectReport } from "./report-filter.ts";
import { RunFilterMenu } from "./run-filters.tsx";
import { closeTicket, openTicket, useActiveTicket } from "./selection.ts";
import { AppShell } from "./shell.tsx";
import { groupByLabel, viewLabel } from "./terms.ts";
import { ticketRefId } from "./ticket-key.ts";
import { phoneGutter, projectHeaderLayout } from "./tokens.stylex.ts";
import { frame, headerControlStyle, shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import {
	clearedRunFilters,
	defaultGraphDirection,
	defaultGraphGroupBy,
	defaultGraphLayout,
	emptyMaxAgeDays,
	type GroupBy,
	groupByKeys,
	groupByWasSaved,
	openedView,
	type pageViews,
	savedProjectView,
} from "./view-settings.ts";

const searchSaveDelayMs = 400;

const views = [
	{ id: "board", label: viewLabel.board },
	{ id: "graph", label: viewLabel.graph },
	{ id: "table", label: viewLabel.table },
] as const;

type PageView = (typeof pageViews)[number];

const emptyView = savedProjectView({}, "");

function isPageView(value: string): value is PageView {
	return views.some((item) => item.id === value);
}

function projectName(): string {
	return decodeURIComponent(
		window.location.pathname.slice("/projects/".length),
	);
}

function countLine(report: ProjectReport): string {
	const total = report.total;
	const done = report.done;
	const needs = report.tickets.filter((ticket) => ticket.needsYou).length;
	const blocked = report.tickets.filter((ticket) => ticket.blocked).length;
	const outside = report.tickets.filter(
		(ticket) => (ticket.outsideBlockers ?? []).length > 0,
	).length;
	const need = needs === 1 ? "needs" : "need";
	return `${done} of ${total} done, ${needs} ${need} you, ${blocked} blocked (${outside} by other projects)`;
}

function isGroupBy(value: string): value is GroupBy {
	return (groupByKeys as readonly string[]).includes(value);
}

function graphGroupBy(settings: ProjectViewSettings): GroupBy {
	return settings.groupBy ?? defaultGraphGroupBy;
}

export function Page() {
	const [name, setName] = useState(projectName);
	const [settings, setSettings] = useState<ProjectViewSettings>(emptyView);
	const [view, setView] = useState<PageView>("board");
	const groupBySavedRef = useRef(false);
	const [filterOpen, setFilterOpen] = useState(false);
	const [runFilterOpen, setRunFilterOpen] = useState(false);
	const ticketFocus = useFocusView();
	const clearFocus = ticketFocus.clear;
	useEffect(() => {
		void name;
		clearFocus();
	}, [name, clearFocus]);
	const reportQuery = useQuery(pageQuery.project(name, "all"));
	const refresh = useRefreshProject(name);
	const overviewQuery = useQuery(pageQuery.overview);
	const settingsQuery = useQuery(pageQuery.settings);
	const fullReport = reportQuery.data;
	const report = useMemo(
		() =>
			fullReport === undefined || fullReport === null
				? null
				: filterProjectReport(fullReport, settings, new Date()),
		[fullReport, settings],
	);
	const missing = reportQuery.isError || fullReport === null;
	const counts = overviewQuery.data?.projects.find(
		(item) => item.name.toLowerCase() === name.toLowerCase(),
	);
	const pollError = counts?.error ?? reportQuery.error?.message ?? null;
	const polling =
		overviewQuery.data?.polling === true ||
		(overviewQuery.data === undefined && !reportQuery.isFetched);
	const active = useActiveTicket();
	const save = useSaveSettings({ refetchProjects: false });
	const pendingSave = useRef<{
		timer: ReturnType<typeof setTimeout>;
		write: () => void;
	} | null>(null);
	useEffect(
		() => () => {
			const pending = pendingSave.current;
			if (pending !== null) {
				clearTimeout(pending.timer);
				pendingSave.current = null;
				pending.write();
			}
		},
		[],
	);
	const saveChain = useRef(Promise.resolve());
	const saveGeneration = useRef(0);
	const projectViews = settingsQuery.data?.projectViews;
	useEffect(() => {
		const onPop = () => {
			if (!window.location.pathname.startsWith("/projects/")) {
				return;
			}
			setName(projectName());
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
	useEffect(() => {
		const loaded = name;
		if (projectViews === undefined || saveGeneration.current !== 0) {
			return;
		}
		const saved = savedProjectView(projectViews, loaded);
		setSettings(saved);
		setView(openedView(saved));
		groupBySavedRef.current = groupByWasSaved(projectViews, loaded);
	}, [name, projectViews]);
	const outsideNames = [
		...new Set([
			...(report?.tickets ?? []).flatMap((item) =>
				(item.outsideBlockers ?? []).map((blocker) => blocker.project),
			),
			...(report?.outsideParents ?? []).flatMap((parent) =>
				parent.tracked ? [parent.project] : [],
			),
		]),
	].sort((left, right) => left.localeCompare(right));
	const outsideQueries = useQueries({
		queries: outsideNames.map((project) => pageQuery.project(project, "all")),
	});
	const outsideReports = outsideQueries.flatMap((item) => item.data ?? []);
	const ticket = active?.key ?? null;
	if (missing && !polling && pollError === null) {
		return (
			<AppShell>
				<main className={clsx(frame.page, phoneGutter.page, frame.wide)}>
					Project not found
				</main>
			</AppShell>
		);
	}
	if (report === null) {
		return <ProjectWaiting name={name} counts={counts} error={pollError} />;
	}
	const saveView = (
		next: ProjectViewSettings,
		shown?: PageView,
		delayMs = 0,
	) => {
		const project = name;
		const generation = saveGeneration.current + 1;
		saveGeneration.current = generation;
		setSettings(next);
		if (shown !== undefined) {
			setView(shown);
		}
		if (pendingSave.current !== null) {
			clearTimeout(pendingSave.current.timer);
			pendingSave.current = null;
		}
		if (delayMs > 0) {
			const write = () => writeView(next, shown, project, generation);
			pendingSave.current = {
				timer: setTimeout(() => {
					pendingSave.current = null;
					write();
				}, delayMs),
				write,
			};
			return;
		}
		writeView(next, shown, project, generation);
	};
	const writeView = (
		next: ProjectViewSettings,
		shown: PageView | undefined,
		project: string,
		generation: number,
	) => {
		const { openView: _openView, ...own } = next;
		const kept = groupBySavedRef.current
			? own
			: (({ groupBy: _groupBy, ...rest }) => rest)(own);
		const write = saveChain.current.then(async () => {
			if (generation !== saveGeneration.current) {
				return;
			}
			const written = await save.mutateAsync((current) => {
				const projectViews: Record<string, ProjectViewSettings> = {
					...current.projectViews,
				};
				const key =
					Object.keys(projectViews).find(
						(item) => item.toLowerCase() === project.toLowerCase(),
					) ?? project;
				if (shown === undefined) {
					projectViews[key] = kept;
				} else if (kept.lastView !== undefined) {
					const previous = projectViews[key] ?? {
						maxAgeDays: emptyMaxAgeDays,
						needsYouOnly: false,
						blockedOnly: false,
						assignees: [],
						search: "",
						...clearedRunFilters,
						graphDirection: defaultGraphDirection,
						graphLayout: defaultGraphLayout,
					};
					projectViews[key] = { ...previous, lastView: kept.lastView };
				}
				return { ...current, projectViews };
			});
			if (generation !== saveGeneration.current) {
				return;
			}
			const views = written.settings.projectViews;
			const confirmed = savedProjectView(views, project);
			groupBySavedRef.current = groupByWasSaved(views, project);
			setSettings(confirmed);
		});
		saveChain.current = write.catch(() => {});
	};
	const seeds = shownSeeds(ticketFocus.focus, ticketFocus.preview);
	const chain = seeds.size === 0 ? null : focusChain(seeds, graphEdges(report));
	const focusValue: TicketFocus = {
		active: chain !== null,
		faded: (key) =>
			chain !== null &&
			(key === null || !chain.has(projectNodeId(report.name, key))),
		toggle: (key) => ticketFocus.toggle(projectNodeId(report.name, key)),
		enter: (key) => ticketFocus.enter(projectNodeId(report.name, key)),
		leave: ticketFocus.leave,
	};
	const openTicketInPanel = (key: string, pullUrl?: string) => {
		if (!openUnlinkedPr(report, key, pullUrl)) {
			openTicket({ tracker: report.tracker, project: report.name, key });
		}
	};
	return (
		<ReactFlowProvider>
			<TicketFocusContext.Provider value={focusValue}>
				<AppShell>
					<main
						className={clsx(
							frame.page,
							phoneGutter.page,
							frame.wide,
							frame.fill,
							board.pageTop,
						)}
					>
						<div className={clsx(board.head, projectHeaderLayout.head)}>
							<div className={clsx(board.identity)}>
								<h1 className={clsx(board.name)}>{report.name}</h1>
								<p className={clsx(board.counts)}>{countLine(report)}</p>
							</div>
							<div className={clsx(board.toolbar, projectHeaderLayout.toolbar)}>
								<RefreshButton
									id="project-refresh"
									queryKey={pageQuery.project(name, "all").queryKey}
									refreshing={
										polling || reportQuery.isFetching || refresh.isPending
									}
									onRefresh={() => refresh.mutate()}
								/>
								<TicketFilterMenu
									report={report}
									view={settings}
									open={filterOpen}
									onOpen={setFilterOpen}
									onChange={saveView}
								/>
								<RunFilterMenu
									report={fullReport ?? report}
									view={settings}
									open={runFilterOpen}
									onOpen={setRunFilterOpen}
									onChange={saveView}
								/>
								<TextInput
									id="project-search"
									width={board.find}
									type="search"
									icon="search"
									aria-label="Search"
									placeholder="Search"
									value={settings.search}
									onChange={(event) =>
										saveView(
											{ ...settings, search: event.target.value },
											undefined,
											searchSaveDelayMs,
										)
									}
								/>
								<ClearFiltersButton
									report={report}
									view={settings}
									onClear={() => saveView(clearedView(settings, report.lanes))}
								/>
								{ticketFocus.focus.size === 0 ? null : (
									<ClearFocusButton onClear={ticketFocus.clear} />
								)}
								<Dropdown
									id="project-group"
									label="Group by"
									icon={Group}
									style={headerControlStyle.control}
									steadyWidth
									value={
										view === "graph"
											? graphGroupBy(settings)
											: boardGroupBy(settings)
									}
									choices={groupByKeys.map((id) => ({
										id,
										label: `Group by ${groupByLabel[id]}`,
									}))}
									onChange={(id) => {
										if (isGroupBy(id)) {
											groupBySavedRef.current = true;
											saveView({ ...settings, groupBy: id });
										}
									}}
								/>
								<fieldset className={clsx(headerControlStyle.group)}>
									<legend className={clsx(frame.visuallyHidden)}>Views</legend>
									{views.map((item) => (
										<Segment
											key={item.id}
											id={`view-${item.id}`}
											label={item.label}
											on={view === item.id}
											onClick={() => {
												if (!isPageView(item.id)) {
													return;
												}
												saveView({ ...settings, lastView: item.id }, item.id);
											}}
										/>
									))}
								</fieldset>
							</div>
						</div>
						{counts === undefined || counts.error === null ? null : (
							<p id="project-error" className={clsx(shell.stale)}>
								{counts.error}
							</p>
						)}
						<div
							data-project={report.name}
							data-open-view={view}
							data-group-by={
								view === "graph"
									? graphGroupBy(settings)
									: boardGroupBy(settings)
							}
						/>
						<div className={clsx(board.stage)}>
							{hidingFiltersOf(report).length > 0 ? (
								<FilteredEmpty
									names={hidingFiltersOf(report)}
									onClear={() => saveView(clearedView(settings, report.lanes))}
								/>
							) : view === "board" ? (
								<Board
									report={report}
									settings={settings}
									selected={ticket}
									onOpen={openTicketInPanel}
									onOpenOutside={openTicket}
								/>
							) : view === "table" ? (
								<TicketTable
									report={report}
									groupBy={boardGroupBy(settings)}
									searching={settings.search.trim() !== ""}
									selected={ticket}
									onOpen={openTicketInPanel}
									onOpenOutside={openTicket}
								/>
							) : view === "graph" ? (
								<ProjectGraph
									report={report}
									reports={outsideReports}
									direction={settings.graphDirection}
									layout={settings.graphLayout}
									groupBy={graphGroupBy(settings)}
									assignees={settings.assignees}
									openKey={ticket}
									seeds={seeds}
									onFocus={ticketFocus.toggle}
									onPreview={ticketFocus.enter}
									onPreviewEnd={ticketFocus.leave}
									onDirection={(next) =>
										saveView({ ...settings, graphDirection: next })
									}
									onLayout={(next) =>
										saveView({ ...settings, graphLayout: next })
									}
									onOpen={(node) => {
										if (node.outside) {
											openTicket(node);
											return;
										}
										openTicketInPanel(node.key);
									}}
								/>
							) : (
								<p className={clsx(board.placeholder)}>{view}</p>
							)}
							{active === null ? null : (
								<TicketPanel
									key={ticketRefId(active)}
									ticket={active}
									onClose={closeTicket}
								/>
							)}
						</div>
					</main>
				</AppShell>
			</TicketFocusContext.Provider>
		</ReactFlowProvider>
	);
}
