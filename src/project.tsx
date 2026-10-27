import { Button } from "./button.tsx";
import { Segment } from "./segment.tsx";
import { TextInput } from "./text-input.tsx";
import "@xyflow/react/dist/style.css";
import * as stylex from "@stylexjs/stylex";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { board } from "./board-styles.ts";
import {
	BlockerChips,
	Chip,
	OutsideParentsContext,
	relationSplit,
	ServerChips,
} from "./card-chips.tsx";
import { useCollapse } from "./collapse.ts";
import type { ProjectViewSettings } from "./configuration.ts";
import { useTicketMenu } from "./context-menu.tsx";
import type {
	OutsideParent,
	ProjectReport,
	StatusType,
	TicketRelation,
	TicketView,
} from "./domain.ts";
import { Dropdown } from "./dropdown.tsx";
import { ClearFocusButton } from "./focus-controls.tsx";
import {
	clickCard,
	type ClickKeys,
	shownSeeds,
	useFocusView,
} from "./focus.ts";
import { graphEdges, projectNodeId } from "./graph-flow.ts";
import { parentChip, ticketGroups } from "./grouping.ts";
import { displayedLaneName, doneTicketsForLane } from "./lanes.ts";
import { focusChain } from "./links.ts";
import { openPage, runPagePath } from "./page-links.ts";
import { TicketPanel } from "./panel.tsx";
import { RefreshButton } from "./poll-freshness.tsx";
import { RunFilterMenu, TicketFilterMenu } from "./project-filters.tsx";
import { ProjectGraph } from "./project-graph.tsx";
import { ProjectWaiting } from "./project-waiting.tsx";
import { pageQuery, useRefreshProject, useSaveSettings } from "./queries.ts";
import { filterProjectReport } from "./report.ts";
import { closeTicket, openTicket, useActiveTicket } from "./selection.ts";
import { AppShell } from "./shell.tsx";
import { useLaneColour } from "./state-colours.ts";
import { tonedProps } from "./state-tone.ts";
import { tableTree } from "./table-tree-styles.ts";
import {
	filterEmptyLabel,
	groupByLabel,
	type HidingFilter,
	hidingFilterIds,
	hidingFilterLabel,
	navLabel,
	openParentLabel,
	stateLabel,
	subTicketsToggleLabel,
	viewLabel,
} from "./terms.ts";
import { TicketCardBody } from "./ticket-card.tsx";
import {
	foldKey,
	itemId,
	outsideKey,
	sameTicketKey,
	shortKey,
	ticketRefId,
} from "./ticket-key.ts";
import { type TreeRow, treeRows } from "./ticket-tree.ts";
import { phoneGutter, projectHeaderLayout } from "./tokens.stylex.ts";
import { frame, headerControlStyle, shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import {
	clearedRunFilters,
	defaultGraphDirection,
	defaultGraphGroupBy,
	defaultGraphLayout,
	defaultGroupBy,
	emptyMaxAgeDays,
	type GroupBy,
	groupByKeys,
	groupByWasSaved,
	openedView,
	type pageViews,
	savedProjectView,
	visibleLaneNames,
} from "./view-settings.ts";

const searchSaveDelayMs = 400;
const doneCap = 5;

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

function visibleLanes(
	report: ProjectReport,
	view: ProjectViewSettings,
): ProjectReport["lanes"] {
	const names = new Set(
		visibleLaneNames(report.lanes, view.shownLanes).map((name) =>
			name.toLowerCase(),
		),
	);
	return report.lanes.filter((lane) => names.has(lane.name.toLowerCase()));
}

function clearedView(
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

function hidingFiltersOf(report: ProjectReport): HidingFilter[] {
	return (report.hiddenBy ?? []).filter((id) =>
		hidingFilterIds.some((known) => known === id),
	);
}

function FilteredEmpty({
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

function boardGroupBy(settings: ProjectViewSettings): GroupBy {
	return settings.groupBy ?? defaultGroupBy;
}

function laneTickets(report: ProjectReport, lane: string): TicketView[] {
	return report.tickets.filter((ticket) => displayedLaneName(ticket) === lane);
}

type TicketFocus = {
	active: boolean;
	faded: (key: string | null) => boolean;
	toggle: (key: string) => void;
	enter: (key: string) => void;
	leave: () => void;
};

const TicketFocusContext = createContext<TicketFocus>({
	active: false,
	faded: () => false,
	toggle: () => {},
	enter: () => {},
	leave: () => {},
});

function groupFaded(focus: TicketFocus, tickets: TicketView[]): boolean {
	return focus.active && tickets.every((ticket) => focus.faded(ticket.key));
}

function focusPointer(
	focus: TicketFocus,
	key: string | null,
	onOpen: (key: string) => void,
	runId: string | undefined,
) {
	if (key === null) {
		return {};
	}
	return {
		onClick: (event: ClickKeys) =>
			clickCard(event, {
				focus: () => focus.toggle(key),
				open: () => onOpen(key),
				openRun:
					runId === undefined ? undefined : () => openPage(runPagePath(runId)),
			}),
		onMouseEnter: () => focus.enter(key),
		onMouseLeave: focus.leave,
		onDoubleClick: () => focus.toggle(key),
	};
}

function Card({
	ticket,
	onOpen,
	onOpenOutside,
}: {
	ticket: TicketView;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	const key = ticket.key;
	const focus = useContext(TicketFocusContext);
	const faded = focus.faded(key);
	const laneColour = useLaneColour();
	const outsideParents = useContext(OutsideParentsContext);
	return (
		<li className={clsx(faded && board.faded)}>
			<button
				type="button"
				{...tonedProps(
					laneColour(ticket.lane),
					ticket.statusType,
					board.card,
					board.cardFocus,
					board.toned,
				)}
				data-ticket={key ?? ""}
				data-faded={faded ? "true" : "false"}
				{...focusPointer(focus, key, onOpen, ticket.factoryRun?.id)}
			>
				<TicketCardBody
					ticket={ticket}
					keyLabel={key === null ? null : shortKey(key)}
					hierarchy
					{...(ticket.parent === undefined
						? {}
						: { parent: parentChip(outsideParents, ticket.parent) })}
					open={{ onOpen, onOpenOutside }}
				/>
			</button>
		</li>
	);
}

/** The outside parent ticket that names a workstream group, as the dashed outside card of the project graph. */
function OutsideParentCard({
	parent,
	onOpenOutside,
}: {
	parent: OutsideParent;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	const known = parent.state;
	const menu = useTicketMenu(parent.tracked ? parent.project : undefined);
	const styles = [
		board.card,
		board.cardFocus,
		known !== undefined && board.toned,
		board.ticketOutside,
		known === undefined && board.ticketOutsideUntoned,
	];
	return (
		<li>
			<button
				type="button"
				{...(known === undefined
					? stylex.props(...styles)
					: tonedProps(undefined, known, ...styles))}
				data-outside-parent={parent.key}
				data-state={known ?? "unknown"}
				onClick={() => onOpenOutside(parent)}
				{...menu}
			>
				<TicketCardBody
					ticket={{ key: parent.key, title: parent.title, blockers: [] }}
					keyLabel={outsideKey(parent.project, parent.key)}
					labels={
						<span className={clsx(board.pull)}>
							{known === undefined ? openParentLabel : stateLabel[known]}
						</span>
					}
					hierarchy={false}
				/>
			</button>
		</li>
	);
}

function LaneCards({
	tickets,
	head,
	onOpen,
	onOpenOutside,
}: {
	tickets: TicketView[];
	head?: OutsideParent | undefined;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	return (
		<ul className={clsx(board.cards)}>
			{head === undefined ? null : (
				<OutsideParentCard parent={head} onOpenOutside={onOpenOutside} />
			)}
			{tickets.map((ticket) => (
				<Card
					key={ticket.key ?? ticket.title}
					ticket={ticket}
					onOpen={onOpen}
					onOpenOutside={onOpenOutside}
				/>
			))}
		</ul>
	);
}

function Lane({
	name,
	colour,
	statusType,
	tickets,
	fresh,
	groupBy,
	capped,
	shown,
	reveal,
	onShowAll,
	onOpen,
	onOpenOutside,
}: {
	name: string;
	colour: string;
	statusType: StatusType;
	tickets: TicketView[];
	fresh: TicketView[];
	groupBy: GroupBy;
	capped: boolean;
	shown: boolean;
	reveal: string | null;
	onShowAll: () => void;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	const pool = capped && !shown ? fresh : tickets;
	const listed = pool.slice(0, capped && !shown ? doneCap : pool.length);
	const selected =
		capped && !shown && reveal !== null
			? pool.slice(doneCap).filter((ticket) => ticket.key === reveal)
			: [];
	const visible = [...listed, ...selected];
	const showAll = capped && !shown && listed.length < tickets.length;
	const focus = useContext(TicketFocusContext);
	const outsideParents = useContext(OutsideParentsContext);
	const headFaded = groupFaded(focus, visible);
	return (
		<section className={clsx(board.lane)} data-lane={name} aria-label={name}>
			<div
				className={clsx(board.laneHead, headFaded && board.faded)}
				data-faded={headFaded ? "true" : "false"}
			>
				<h2 className={clsx(board.laneTitle)}>
					<span
						{...tonedProps(colour, statusType, board.laneMark)}
						data-state={statusType}
					/>
					<span className={clsx(board.laneName)} title={name}>
						{name}
					</span>{" "}
					{listed.length}
				</h2>
				{showAll ? (
					<Button label="Show all" data-show-all={name} onClick={onShowAll} />
				) : null}
			</div>
			<div className={clsx(board.laneBody)} data-lane-cards={name}>
				{groupBy === "none" ? (
					<LaneCards
						tickets={visible}
						onOpen={onOpen}
						onOpenOutside={onOpenOutside}
					/>
				) : (
					ticketGroups(visible, groupBy).map((group) => (
						<div key={group.name} data-group={group.label}>
							<h3
								className={clsx(
									board.swimlane,
									groupFaded(focus, group.tickets) && board.faded,
								)}
							>
								{group.label}
							</h3>
							<LaneCards
								tickets={group.tickets}
								head={
									groupBy === "workstream"
										? outsideParents.find((parent) =>
												sameTicketKey(parent.key, group.name),
											)
										: undefined
								}
								onOpen={onOpen}
								onOpenOutside={onOpenOutside}
							/>
						</div>
					))
				)}
			</div>
		</section>
	);
}

const columns = [
	"key",
	"title",
	"state",
	"pr",
	"blockedBy",
	"blocks",
	"needsYou",
	"updated",
] as const;

type Column = (typeof columns)[number];

const columnLabel: Record<Column, string> = {
	key: "Key",
	title: "Title",
	state: "State",
	pr: "PR",
	blockedBy: "Blocked by",
	blocks: "Blocks",
	needsYou: "Needs you",
	updated: "Updated",
};

function relationKeys(
	ticket: TicketView,
	column: "blockedBy" | "blocks",
): string[] {
	if (column === "blocks") {
		return (ticket.blocks ?? []).map((blocker) => blocker.key);
	}
	const { local, outside } = relationSplit(ticket);
	return [...local, ...outside.map((blocker) => blocker.key)];
}

function displayedLane(
	ticket: TicketView,
	lanes: ProjectReport["lanes"],
): ProjectReport["lanes"][number] | undefined {
	const name = displayedLaneName(ticket);
	return lanes.find((lane) => lane.name === name);
}

const unknownLane = Number.MAX_SAFE_INTEGER;

function laneRank(ticket: TicketView, lanes: ProjectReport["lanes"]): number {
	const index = lanes.findIndex(
		(lane) => lane.name === displayedLaneName(ticket),
	);
	return index === -1 ? unknownLane : index;
}

function sortValue(
	ticket: TicketView,
	column: Column,
	lanes: ProjectReport["lanes"],
): string | number {
	if (column === "key") {
		return foldKey(ticket.key) ?? "";
	}
	if (column === "title") {
		return ticket.title.toLowerCase();
	}
	if (column === "state") {
		return laneRank(ticket, lanes);
	}
	if (column === "pr") {
		return ticket.pull?.toLowerCase() ?? "";
	}
	if (column === "needsYou") {
		return ticket.needsYou === true ? 1 : 0;
	}
	if (column === "updated") {
		const at = Date.parse(ticket.updatedAt ?? "");
		return Number.isNaN(at) ? 0 : at;
	}
	return relationKeys(ticket, column).join(" ").toLowerCase();
}

function compareTickets(
	left: TicketView,
	right: TicketView,
	column: Column,
	direction: "asc" | "desc",
	lanes: ProjectReport["lanes"],
): number {
	const leftValue = sortValue(left, column, lanes);
	const rightValue = sortValue(right, column, lanes);
	const order =
		typeof leftValue === "number" && typeof rightValue === "number"
			? leftValue - rightValue
			: String(leftValue).localeCompare(String(rightValue));
	if (order !== 0) {
		return direction === "asc" ? order : -order;
	}
	return (left.key ?? left.title).localeCompare(right.key ?? right.title);
}

function SortMark({ direction }: { direction: "asc" | "desc" }) {
	return (
		<svg
			viewBox="0 0 8 8"
			aria-hidden="true"
			className={clsx(board.sortMark, direction === "desc" && board.sortDown)}
		>
			<path d="M1 5.5 4 2.5 7 5.5" fill="none" stroke="currentColor" />
		</svg>
	);
}

function updatedLabel(value: string | undefined): string {
	const at = Date.parse(value ?? "");
	if (Number.isNaN(at)) {
		return "";
	}
	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
	}).format(new Date(at));
}

type TreeToggle = { collapsed: boolean; onToggle: () => void };

function RowIndent({
	depth,
	children,
}: {
	depth: number;
	children: ReactNode;
}) {
	if (depth === 0) {
		return <span className={clsx(tableTree.tree)}>{children}</span>;
	}
	return (
		<span className={clsx(tableTree.tree, tableTree.indent)}>
			<RowIndent depth={depth - 1}>{children}</RowIndent>
		</span>
	);
}

function RowToggle({
	ticketKey,
	toggle,
}: {
	ticketKey: string;
	toggle: TreeToggle | null;
}) {
	if (toggle === null) {
		return <span className={clsx(tableTree.toggleSpace)} />;
	}
	return (
		<button
			type="button"
			className={clsx(tableTree.toggle, shell.buttonFocus)}
			data-toggle={ticketKey}
			aria-expanded={!toggle.collapsed}
			aria-label={subTicketsToggleLabel(ticketKey, toggle.collapsed)}
			onClick={(event) => {
				event.stopPropagation();
				toggle.onToggle();
			}}
			onDoubleClick={(event) => event.stopPropagation()}
		>
			<svg
				viewBox="0 0 8 8"
				aria-hidden="true"
				className={clsx(
					tableTree.toggleMark,
					toggle.collapsed && tableTree.toggleShut,
				)}
			>
				<path d="M2.5 1 5.5 4 2.5 7" fill="none" stroke="currentColor" />
			</svg>
		</button>
	);
}

function TableRow({
	ticket,
	project,
	lanes,
	order,
	selected,
	tree,
	onOpen,
	onOpenOutside,
}: {
	ticket: TicketView;
	project: string;
	lanes: ProjectReport["lanes"];
	order: number;
	selected: boolean;
	tree: { depth: number; toggle: TreeToggle | null } | null;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	const key = ticket.key;
	const { local, outside } = relationSplit(ticket);
	const lane = displayedLane(ticket, lanes);
	return (
		<tr
			className={clsx(board.row, selected && board.rowOn)}
			data-ticket={key ?? ""}
			data-order={order}
			data-selected={selected ? "true" : "false"}
			data-depth={tree?.depth}
			{...(key === null ? {} : { onClick: () => onOpen(key) })}
			tabIndex={key === null ? undefined : 0}
			onKeyDown={(event) => {
				if (
					event.target !== event.currentTarget ||
					key === null ||
					(event.key !== "Enter" && event.key !== " ")
				) {
					return;
				}
				event.preventDefault();
				onOpen(key);
			}}
		>
			<td className={clsx(board.rowCell, board.rowKey)}>
				{tree === null ? (
					key === null ? (
						""
					) : (
						shortKey(key)
					)
				) : (
					<RowIndent depth={tree.depth}>
						<RowToggle ticketKey={key ?? ""} toggle={tree.toggle} />
						{key === null ? "" : shortKey(key)}
					</RowIndent>
				)}
			</td>
			<td className={clsx(board.rowCell, board.rowTitle)}>{ticket.title}</td>
			<td className={clsx(board.rowCell)}>
				<span
					{...tonedProps(lane?.colour, lane?.statusType, board.stateMark)}
				/>
				{displayedLaneName(ticket)}
				{ticket.chips === undefined ? null : (
					<span className={clsx(board.links)}>
						<ServerChips ticket={ticket} />
					</span>
				)}
			</td>
			<td className={clsx(board.rowCell)}>{ticket.pull ?? ""}</td>
			<td className={clsx(board.rowCell)}>
				<span className={clsx(board.links)}>
					<BlockerChips
						local={local}
						outside={outside}
						open={{ onOpen, onOpenOutside }}
					/>
				</span>
			</td>
			<td className={clsx(board.rowCell)}>
				<span className={clsx(board.links)}>
					{(ticket.blocks ?? []).map((blocker) => {
						const sameProject =
							blocker.project.toLowerCase() === project.toLowerCase();
						return (
							<Chip
								key={blocker.key}
								label={sameProject ? shortKey(blocker.key) : blocker.key}
								ticketKey={blocker.key}
								{...(sameProject
									? {}
									: { outside: true, project: blocker.project })}
								onOpen={sameProject ? onOpen : () => onOpenOutside(blocker)}
							/>
						);
					})}
				</span>
			</td>
			<td className={clsx(board.rowCell)}>
				{ticket.needsYou ? (
					<span className={clsx(board.needs)}>{navLabel.needsYou}</span>
				) : (
					""
				)}
			</td>
			<td className={clsx(board.rowCell)} data-updated={ticket.updatedAt ?? ""}>
				{updatedLabel(ticket.updatedAt)}
			</td>
		</tr>
	);
}

function TicketTable({
	report,
	groupBy,
	searching,
	selected,
	onOpen,
	onOpenOutside,
}: {
	report: ProjectReport;
	groupBy: GroupBy;
	searching: boolean;
	selected: string | null;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	const [column, setColumn] = useState<Column>("state");
	const [direction, setDirection] = useState<"asc" | "desc">("asc");
	const collapse = useCollapse();
	const [searchShut, setSearchShut] = useState<Record<string, boolean>>({});
	useEffect(() => {
		if (!searching) {
			setSearchShut({});
		}
	}, [searching]);
	const collapsed = (key: string, startsCollapsed: boolean) =>
		searching
			? (searchShut[foldKey(key)] ?? false)
			: collapse.collapsed(key, startsCollapsed);
	const toggle = (key: string, startsCollapsed: boolean) => {
		if (searching) {
			setSearchShut((current) => ({
				...current,
				[foldKey(key)]: !collapsed(key, startsCollapsed),
			}));
			return;
		}
		collapse.toggle(key, startsCollapsed);
	};
	const rows = [...report.tickets].sort((left, right) =>
		compareTickets(left, right, column, direction, report.lanes),
	);
	const toggleOf = ({
		ticket,
		hasSubTickets,
		startsCollapsed,
	}: TreeRow<TicketView>): TreeToggle | null => {
		const key = ticket.key;
		return key === null || !hasSubTickets
			? null
			: {
					collapsed: collapsed(key, startsCollapsed),
					onToggle: () => toggle(key, startsCollapsed),
				};
	};
	const tableRows = (tickets: readonly TicketView[]) =>
		groupBy === "workstream" || groupBy === "theme"
			? treeRows(tickets, collapsed).map((row) => ({
					ticket: row.ticket,
					tree: { depth: row.depth, toggle: toggleOf(row) },
				}))
			: tickets.map((ticket) => ({ ticket, tree: null }));
	return (
		<div
			className={clsx(board.grid)}
			data-sort={column}
			data-direction={direction}
			data-group-by={groupBy}
		>
			{rows.length === 0 ? (
				<p className={clsx(board.empty)}>No tickets</p>
			) : (
				<table className={clsx(board.rows)}>
					<thead>
						<tr>
							{columns.map((item) => (
								<th
									key={item}
									className={clsx(board.headerCell)}
									scope="col"
									aria-sort={
										column === item
											? direction === "asc"
												? "ascending"
												: "descending"
											: "none"
									}
								>
									<button
										type="button"
										className={clsx(board.sort, shell.buttonFocus)}
										data-column={item}
										aria-label={
											column === item
												? `Sort by ${columnLabel[item]}, ${direction === "asc" ? "ascending" : "descending"}`
												: `Sort by ${columnLabel[item]}`
										}
										onClick={() => {
											if (column === item) {
												setDirection((current) =>
													current === "asc" ? "desc" : "asc",
												);
												return;
											}
											setColumn(item);
											setDirection("asc");
										}}
									>
										{columnLabel[item]}
										{column === item ? (
											<SortMark direction={direction} />
										) : null}
									</button>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{ticketGroups(rows, groupBy).flatMap((group) => {
							const heading: ReactNode[] =
								groupBy === "none"
									? []
									: [
											<tr key={`group-${group.name}`} data-group={group.label}>
												<th
													className={clsx(board.groupRow)}
													colSpan={columns.length}
													scope="rowgroup"
												>
													{group.label} {group.tickets.length}
												</th>
											</tr>,
										];
							return [
								...heading,
								...tableRows(group.tickets).map(({ ticket, tree }) => (
									<TableRow
										key={itemId(group.name, ticket.key ?? ticket.title)}
										ticket={ticket}
										tree={tree}
										project={report.name}
										lanes={report.lanes}
										order={
											rows.findIndex(
												(item) =>
													item.key === ticket.key &&
													item.title === ticket.title,
											) + 1
										}
										selected={selected !== null && ticket.key === selected}
										onOpen={onOpen}
										onOpenOutside={onOpenOutside}
									/>
								)),
							];
						})}
					</tbody>
				</table>
			)}
		</div>
	);
}

function Board({
	report,
	settings,
	selected,
	onOpen,
	onOpenOutside,
}: {
	report: ProjectReport;
	settings: ProjectViewSettings;
	selected: string | null;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	const [shownDone, setShownDone] = useState(false);
	return (
		<OutsideParentsContext.Provider value={report.outsideParents}>
			<div
				className={clsx(board.lanes)}
				data-lanes=""
				data-group-by={boardGroupBy(settings)}
			>
				{visibleLanes(report, settings).map((lane) => (
					<Lane
						key={lane.id}
						name={lane.name}
						colour={lane.colour}
						statusType={lane.statusType}
						groupBy={boardGroupBy(settings)}
						tickets={
							lane.statusType === "done"
								? doneTicketsForLane(report, lane.name)
								: laneTickets(report, lane.name)
						}
						fresh={laneTickets(report, lane.name)}
						capped={lane.statusType === "done"}
						shown={shownDone}
						reveal={selected}
						onShowAll={() => setShownDone(true)}
						onOpen={onOpen}
						onOpenOutside={onOpenOutside}
					/>
				))}
			</div>
		</OutsideParentsContext.Provider>
	);
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
	const openTicketInPanel = (key: string) => {
		const unlinked = report.tickets.find(
			(item) => item.unlinkedPr && item.key === key,
		);
		if (unlinked?.pullUrl !== undefined) {
			window.open(unlinked.pullUrl, "_blank", "noopener");
			return;
		}
		openTicket({ tracker: report.tracker, project: report.name, key });
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
								{ticketFocus.focus.size === 0 ? null : (
									<ClearFocusButton onClear={ticketFocus.clear} />
								)}
								<Dropdown
									id="project-group"
									label="Group by"
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
