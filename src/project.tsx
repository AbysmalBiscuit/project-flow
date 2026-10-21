import "@xyflow/react/dist/style.css";
import * as stylex from "@stylexjs/stylex";
import { ReactFlowProvider } from "@xyflow/react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { ProjectViewSettings } from "./configuration.ts";
import type {
	CrossProjectBlocker,
	NeedsYouItem,
	ProjectReport,
	StatusType,
	TicketRelation,
	TicketView,
} from "./domain.ts";
import {
	displayedLaneName,
	doneTicketsForLane,
	sameTicketKey,
	ticketGroups,
} from "./domain.ts";
import { Dropdown } from "./dropdown.tsx";
import { onAppEvent } from "./events.ts";
import { GraphTools } from "./graph-pane.tsx";
import { mountPage, readPageCache, writePageCache } from "./page-cache.ts";
import { TicketPanel } from "./panel.tsx";
import { DirectionSwitch, ProjectGraph } from "./project-graph.tsx";
import { closeTicket, openTicket, useActiveTicket } from "./selection.ts";
import { AppShell, PageFrame, PollStatus } from "./shell.tsx";
import {
	blockedLabel,
	filterEmptyLabel,
	groupByLabel,
	type HidingFilter,
	hidingFilterIds,
	hidingFilterLabel,
	loadingLabel,
	navLabel,
	viewLabel,
} from "./terms.ts";
import {
	lightValues,
	phoneGutter,
	projectHeaderLayout,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { board, frame, headerControlStyle, shell } from "./ui-styles.ts";
import {
	defaultGraphDirection,
	defaultGraphGroupBy,
	defaultGroupBy,
	emptyMaxAgeDays,
	type GroupBy,
	groupByKeys,
	groupByWasSaved,
	laneAgeCap,
	openedView,
	type pageViews,
	savedProjectView,
	visibleLaneNames,
} from "./view-settings.ts";

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

function queryValue(name: string): string | null {
	const value = new URLSearchParams(window.location.search).get(name);
	if (value === null || value.trim() === "") {
		return null;
	}
	return value;
}

function highlightKey(): string | null {
	return queryValue("ticket");
}

function panelProjectName(): string {
	return queryValue("panelProject") ?? projectName();
}

function panelTrackerName(): CrossProjectBlocker["tracker"] {
	return queryValue("panelTracker") === "linear" ? "linear" : "github";
}

function clearTicketQuery(): void {
	const url = new URL(window.location.href);
	if (!url.searchParams.has("ticket")) {
		return;
	}
	url.searchParams.delete("ticket");
	const next = `${url.pathname}${url.search}${url.hash}`;
	window.history.replaceState(window.history.state, "", next);
}

function trackerUrl(
	tracker: "github" | "linear",
	key: string,
): string | undefined {
	if (tracker === "github" && key.includes("#")) {
		return `https://github.com/${key.replace("#", "/issues/")}`;
	}
	if (tracker === "linear") {
		return `https://linear.app/issue/${key}`;
	}
	return undefined;
}

function needsYouItem(
	report: ProjectReport | null,
	tracker: "github" | "linear",
	project: string,
	key: string,
): NeedsYouItem | null {
	if (
		report === null ||
		report.tracker !== tracker ||
		report.name !== project
	) {
		return null;
	}
	const section = report.sections.find((item) => item.id === "needsYou");
	return (
		section?.needsYou?.find(
			(item) =>
				item.tracker === tracker &&
				item.project === project &&
				sameTicketKey(item.key, key),
		) ?? null
	);
}

function panelItem(
	report: ProjectReport | null,
	tracker: "github" | "linear",
	project: string,
	key: string,
	active: {
		tracker: "github" | "linear";
		project: string;
		key: string;
		item?: NeedsYouItem;
	} | null,
): NeedsYouItem | null {
	if (report?.tracker === tracker && report.name === project) {
		return needsYouItem(report, tracker, project, key);
	}
	if (
		active?.tracker === tracker &&
		active.project === project &&
		sameTicketKey(active.key, key)
	) {
		return active.item ?? null;
	}
	return null;
}

function panelBlockers(
	ticket: TicketView | undefined,
	source: ProjectReport | null,
	project: string,
	tracker: "github" | "linear",
): TicketRelation[] {
	if (ticket === undefined) {
		return [];
	}
	const outside = ticket.outsideBlockers ?? [];
	const resolved: TicketRelation[] = [];
	for (const key of ticket.blockers) {
		const known = outside.find(
			(blocker) => blocker.key.toLowerCase() === key.toLowerCase(),
		);
		if (known !== undefined) {
			resolved.push(known);
			continue;
		}
		const local = source?.tickets.find(
			(item) => item.key?.toLowerCase() === key.toLowerCase(),
		);
		resolved.push({
			tracker,
			project,
			key,
			title: local?.title.trim() || key,
		});
	}
	return resolved;
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
			<button
				type="button"
				id="clear-filters"
				className={clsx(board.clearFilters, shell.buttonFocus)}
				onClick={onClear}
			>
				{filterEmptyLabel.clear}
			</button>
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
	return `${done} of ${total} done, ${needs} ${need} you, ${blocked} blocked (${outside} by other projects).`;
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

function shortKey(key: string): string {
	const mark = key.lastIndexOf("#");
	return mark === -1 ? key : key.slice(mark);
}

function relationSplit(ticket: TicketView): {
	local: string[];
	outside: TicketRelation[];
} {
	const outside = ticket.outsideBlockers ?? [];
	const outsideKeys = new Set(
		outside.map((blocker) => blocker.key.toLowerCase()),
	);
	return {
		local: ticket.blockers.filter(
			(blocker) => !outsideKeys.has(blocker.toLowerCase()),
		),
		outside,
	};
}

function Chip({
	label,
	ticketKey,
	outside,
	onOpen,
}: {
	label: string;
	ticketKey?: string;
	outside?: boolean;
	onOpen?: (key: string) => void;
}) {
	if (ticketKey === undefined || onOpen === undefined) {
		return <span className={clsx(board.chip, board.chipStatic)}>{label}</span>;
	}
	return (
		<button
			type="button"
			className={clsx(
				board.chip,
				outside && board.chipOutside,
				shell.buttonFocus,
			)}
			data-chip={ticketKey}
			onClick={(event) => {
				event.stopPropagation();
				onOpen(ticketKey);
			}}
		>
			{label}
			{outside ? " ↗" : ""}
		</button>
	);
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
	const { local, outside } = relationSplit(ticket);
	return (
		<li>
			<button
				type="button"
				className={clsx(
					board.card,
					board.cardHover,
					board.cardFocus,
					ticket.blocked && board.cardBlocked,
				)}
				data-ticket={key ?? ""}
				onClick={() => {
					if (key !== null) {
						onOpen(key);
					}
				}}
			>
				<span className={clsx(board.meta)}>
					{key === null ? (
						<span />
					) : (
						<span className={clsx(board.key)}>{shortKey(key)}</span>
					)}
					{ticket.pull === undefined ? null : (
						<span className={clsx(board.pull)}>{ticket.pull}</span>
					)}
				</span>
				<p className={clsx(board.title)}>{ticket.title}</p>
				{local.length === 0 &&
				outside.length === 0 &&
				!ticket.needsYou ? null : (
					<span className={clsx(board.chips)}>
						{local.map((blocker) => (
							<Chip
								key={blocker}
								label={`${blockedLabel} by ${shortKey(blocker)}`}
								ticketKey={blocker}
								onOpen={onOpen}
							/>
						))}
						{outside.map((blocker) => (
							<Chip
								key={blocker.key}
								label={blocker.key}
								ticketKey={blocker.key}
								outside
								onOpen={() => onOpenOutside(blocker)}
							/>
						))}
						{ticket.needsYou ? (
							<span className={clsx(board.chip, board.chipNeeds)}>
								{navLabel.needsYou}
							</span>
						) : null}
					</span>
				)}
			</button>
		</li>
	);
}

const statusMarks: Record<StatusType, typeof board.markBacklog> = {
	done: board.markDone,
	dropped: board.markDropped,
	backlog: board.markBacklog,
	inProgress: board.markInProgress,
	inReview: board.markInReview,
	awaitingMerge: board.markAwaitingMerge,
};

const laneMarks: Record<string, typeof board.markBacklog> = {
	[lightValues.done.toLowerCase()]: board.markDone,
	[lightValues.dropped.toLowerCase()]: board.markDropped,
	[lightValues.blocked.toLowerCase()]: board.markBlocked,
	[lightValues.backlog.toLowerCase()]: board.markBacklog,
	[lightValues.inProgress.toLowerCase()]: board.markInProgress,
	[lightValues.inReview.toLowerCase()]: board.markInReview,
	[lightValues.awaitingMerge.toLowerCase()]: board.markAwaitingMerge,
};

function laneMark(colour: string, statusType?: StatusType) {
	return (
		(statusType === undefined ? undefined : statusMarks[statusType]) ??
		laneMarks[colour.trim().toLowerCase()] ??
		board.markBacklog
	);
}

function LaneCards({
	tickets,
	onOpen,
	onOpenOutside,
}: {
	tickets: TicketView[];
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	return (
		<ul className={clsx(board.cards)}>
			{tickets.map((ticket) => (
				<Card
					key={`${ticket.key ?? ""} ${ticket.title}`}
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
	return (
		<section className={clsx(board.lane)} data-lane={name} aria-label={name}>
			<h2 className={clsx(board.laneTitle)}>
				<span
					className={clsx(board.laneMark, laneMark(colour, statusType))}
					data-lane-colour={colour}
				/>
				{name} {listed.length}
			</h2>
			<div className={clsx(capped && !shown && board.cardsClip)}>
				{groupBy === "none" ? (
					<LaneCards
						tickets={visible}
						onOpen={onOpen}
						onOpenOutside={onOpenOutside}
					/>
				) : (
					ticketGroups(visible, groupBy).map((group) => (
						<div key={group.name} data-group={group.label}>
							<h3 className={clsx(board.swimlane)}>{group.label}</h3>
							<LaneCards
								tickets={group.tickets}
								onOpen={onOpen}
								onOpenOutside={onOpenOutside}
							/>
						</div>
					))
				)}
			</div>
			{capped && !shown && listed.length < tickets.length ? (
				<button
					type="button"
					className={clsx(
						shell.button,
						shell.buttonHover,
						shell.buttonFocus,
						board.showAll,
					)}
					data-show-all={name}
					onClick={onShowAll}
				>
					Show all
				</button>
			) : null}
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
		return ticket.key?.toLowerCase() ?? "";
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

function TableRow({
	ticket,
	project,
	lanes,
	order,
	selected,
	onOpen,
	onOpenOutside,
}: {
	ticket: TicketView;
	project: string;
	lanes: ProjectReport["lanes"];
	order: number;
	selected: boolean;
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
			onClick={() => {
				if (key !== null) {
					onOpen(key);
				}
			}}
		>
			<td className={clsx(board.rowCell, board.rowKey)}>
				{key === null ? "" : shortKey(key)}
			</td>
			<td className={clsx(board.rowCell, board.rowTitle)}>{ticket.title}</td>
			<td className={clsx(board.rowCell)}>
				<span
					className={clsx(
						board.stateMark,
						lane === undefined
							? board.markBacklog
							: laneMark(lane.colour, lane.statusType),
					)}
				/>
				{displayedLaneName(ticket)}
			</td>
			<td className={clsx(board.rowCell)}>{ticket.pull ?? ""}</td>
			<td className={clsx(board.rowCell)}>
				<span className={clsx(board.links)}>
					{local.map((blocker) => (
						<Chip
							key={blocker}
							label={shortKey(blocker)}
							ticketKey={blocker}
							onOpen={onOpen}
						/>
					))}
					{outside.map((blocker) => (
						<Chip
							key={blocker.key}
							label={blocker.key}
							ticketKey={blocker.key}
							outside
							onOpen={() => onOpenOutside(blocker)}
						/>
					))}
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
								{...(sameProject ? {} : { outside: true })}
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
	selected,
	onOpen,
	onOpenOutside,
}: {
	report: ProjectReport;
	groupBy: GroupBy;
	selected: string | null;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	const [column, setColumn] = useState<Column>("state");
	const [direction, setDirection] = useState<"asc" | "desc">("asc");
	const rows = [...report.tickets].sort((left, right) =>
		compareTickets(left, right, column, direction, report.lanes),
	);
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
								...group.tickets.map((ticket) => (
									<TableRow
										key={`${group.name}\n${ticket.key ?? ""}\n${ticket.title}`}
										ticket={ticket}
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
		<div className={clsx(board.lanes)} data-group-by={boardGroupBy(settings)}>
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
	);
}

function FilterMenu({
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
			if (!root.current?.contains(event.target as Node)) {
				onOpen(false);
			}
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
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

function Page() {
	const [name, setName] = useState(projectName);
	const [ticket, setTicket] = useState(highlightKey);
	const [settings, setSettings] = useState<ProjectViewSettings>(emptyView);
	const [panelProject, setPanelProject] = useState(panelProjectName);
	const panelProjectRef = useRef(panelProject);
	panelProjectRef.current = panelProject;
	const [panelTracker, setPanelTracker] =
		useState<CrossProjectBlocker["tracker"]>(panelTrackerName);
	const panelTrackerRef = useRef(panelTracker);
	panelTrackerRef.current = panelTracker;
	const [open, setOpen] = useState(highlightKey() !== null);
	const [openedState, setOpenedState] = useState<TicketView["state"] | null>(
		null,
	);
	const [view, setView] = useState<PageView>("board");
	const groupBySavedRef = useRef(false);
	const [filterOpen, setFilterOpen] = useState(false);
	const [report, setReport] = useState<ProjectReport | null>(
		() => readPageCache(`project:${projectName()}`) ?? null,
	);
	const [outsideReports, setOutsideReports] = useState<ProjectReport[]>([]);
	const active = useActiveTicket();
	const [panelReport, setPanelReport] = useState<ProjectReport | null>(null);
	const [missing, setMissing] = useState(false);
	const [polling, setPolling] = useState(
		() => readPageCache("polling") !== false,
	);
	const saveChain = useRef(Promise.resolve());
	const saveGeneration = useRef(0);
	useEffect(() => {
		if (active === null) {
			return;
		}
		if (
			active.project !== panelProjectRef.current ||
			active.tracker !== panelTrackerRef.current
		) {
			setPanelReport(null);
		}
		setPanelProject(active.project);
		setPanelTracker(active.tracker);
		setTicket(active.key);
		setOpen(true);
	}, [active]);
	useEffect(() => {
		const onPop = () => {
			if (!window.location.pathname.startsWith("/projects/")) {
				return;
			}
			const next = highlightKey();
			setName(projectName());
			setPanelProject(panelProjectName());
			setPanelTracker(panelTrackerName());
			setTicket(next);
			setOpen(next !== null || window.history.state?.panel === true);
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
	useEffect(() => {
		let stopped = false;
		const loaded = name;
		fetch("/api/settings")
			.then(async (response) => {
				if (stopped || !response.ok) {
					return;
				}
				const body = (await response.json()) as {
					projectViews?: Record<string, ProjectViewSettings>;
				};
				const views = body.projectViews ?? {};
				const saved = savedProjectView(views, loaded);
				setSettings(saved);
				setView(openedView(saved));
				groupBySavedRef.current = groupByWasSaved(views, loaded);
			})
			.catch(() => {});
		return () => {
			stopped = true;
		};
	}, [name]);
	useEffect(() => {
		const loaded = name;
		const path = `/api/projects/${encodeURIComponent(loaded)}`;
		let stopped = false;
		const load = () => {
			fetch(path)
				.then(async (response) => {
					if (stopped) {
						return;
					}
					if (!response.ok) {
						setReport(null);
						setMissing(true);
						return;
					}
					setMissing(false);
					const body = (await response.json()) as ProjectReport;
					writePageCache(`project:${loaded}`, body);
					setReport(body);
					setPanelTracker((current) =>
						panelProjectRef.current === loaded ? body.tracker : current,
					);
				})
				.catch(() => {
					if (!stopped) {
						setReport(null);
						setMissing(true);
					}
				});
		};
		load();
		const readPoll = () => {
			fetch("/api/overview")
				.then(async (response) => {
					if (stopped || !response.ok) {
						return;
					}
					const body = (await response.json()) as { polling?: true };
					const next = body.polling === true;
					writePageCache("polling", next);
					setPolling(next);
				})
				.catch(() => {
					if (!stopped) {
						setPolling(false);
					}
				});
		};
		readPoll();
		const stop = onAppEvent("overview", () => {
			load();
			readPoll();
		});
		return () => {
			stopped = true;
			stop();
		};
	}, [name]);
	const outsideProjects = [
		...new Set(
			(report?.tickets ?? []).flatMap((item) =>
				(item.outsideBlockers ?? []).map((blocker) => blocker.project),
			),
		),
	]
		.sort((left, right) => left.localeCompare(right))
		.join("\n");
	useEffect(() => {
		let stopped = false;
		const load = () => {
			if (outsideProjects === "") {
				setOutsideReports([]);
				return;
			}
			const names = outsideProjects.split("\n");
			Promise.all(
				names.map(async (project) => {
					const response = await fetch(
						`/api/projects/${encodeURIComponent(project)}?view=all`,
					);
					if (!response.ok) {
						return null;
					}
					return (await response.json()) as ProjectReport;
				}),
			)
				.then((loaded) => {
					if (!stopped) {
						setOutsideReports(loaded.flatMap((item) => item ?? []));
					}
				})
				.catch(() => {
					if (!stopped) {
						setOutsideReports([]);
					}
				});
		};
		load();
		const stop = onAppEvent("overview", load);
		return () => {
			stopped = true;
			stop();
		};
	}, [outsideProjects]);
	useEffect(() => {
		if (!open || ticket === null) {
			return;
		}
		let stopped = false;
		const path = `/api/projects/${encodeURIComponent(panelProject)}?view=all`;
		const load = () => {
			fetch(path)
				.then(async (response) => {
					if (stopped || !response.ok) {
						return;
					}
					const body = (await response.json()) as ProjectReport;
					setPanelReport(body);
					setPanelTracker(body.tracker);
				})
				.catch(() => {});
		};
		load();
		const stop = onAppEvent("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			stop();
		};
	}, [open, ticket, panelProject]);
	const source = panelReport;
	const selected =
		source === null || ticket === null
			? undefined
			: source.tickets.find((item) => item.key === ticket);
	const incoming = panelBlockers(selected, source, panelProject, panelTracker);
	const outgoing = selected?.blocks ?? [];
	if (missing && !polling) {
		return (
			<AppShell>
				<main className={clsx(frame.page, phoneGutter.page, frame.wide)}>
					Project not found
				</main>
			</AppShell>
		);
	}
	if (report === null) {
		return <PageFrame title={name}>{loadingLabel}</PageFrame>;
	}
	const saveView = (next: ProjectViewSettings, shown?: PageView) => {
		const project = name;
		const generation = saveGeneration.current + 1;
		saveGeneration.current = generation;
		setSettings(next);
		if (shown !== undefined) {
			setView(shown);
		}
		const kept = groupBySavedRef.current
			? next
			: (({ groupBy: _groupBy, ...rest }) => rest)(next);
		const write = saveChain.current.then(async () => {
			if (generation !== saveGeneration.current) {
				return;
			}
			const response = await fetch("/api/settings");
			if (!response.ok || generation !== saveGeneration.current) {
				return;
			}
			const current: unknown = await response.json();
			if (
				current === null ||
				typeof current !== "object" ||
				generation !== saveGeneration.current
			) {
				return;
			}
			const body = current as {
				projectViews?: Record<string, ProjectViewSettings>;
			};
			const projectViews = { ...(body.projectViews ?? {}) };
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
					graphDirection: defaultGraphDirection,
				};
				projectViews[key] = { ...previous, lastView: kept.lastView };
			}
			const saved = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...body, projectViews }),
			});
			if (!saved.ok || generation !== saveGeneration.current) {
				return;
			}
			const written = (await saved.json()) as {
				projectViews?: Record<string, ProjectViewSettings>;
			};
			if (generation !== saveGeneration.current) {
				return;
			}
			const views = written.projectViews ?? {};
			const confirmed = savedProjectView(views, project);
			groupBySavedRef.current = groupByWasSaved(views, project);
			setSettings(confirmed);
		});
		saveChain.current = write.catch(() => {});
	};
	const openTicketInPanel = (key: string) => {
		setOpenedState(null);
		setPanelProject(report.name);
		setPanelTracker(report.tracker);
		setTicket(key);
		setOpen(true);
		const item = needsYouItem(report, report.tracker, report.name, key);
		openTicket({
			tracker: report.tracker,
			project: report.name,
			key,
			...(item === null ? {} : { item }),
		});
	};
	const openOutsideInPanel = (
		blocker: TicketRelation,
		state?: TicketView["state"],
	) => {
		setOpenedState(state ?? null);
		setPanelReport(null);
		setPanelProject(blocker.project);
		setPanelTracker(blocker.tracker);
		setTicket(blocker.key);
		setOpen(true);
	};
	return (
		<ReactFlowProvider>
			<AppShell>
				<main
					className={clsx(frame.page, phoneGutter.page, frame.wide, frame.fill)}
				>
					<div className={clsx(board.head, projectHeaderLayout.head)}>
						<div className={clsx(board.identity)}>
							<p className={clsx(board.crumb)}>{navLabel.overview} /</p>
							<h1 className={clsx(board.name)}>{report.name}</h1>
							<p className={clsx(board.counts)}>
								{countLine(report)} <PollStatus text={null} polling={polling} />
							</p>
						</div>
						<div className={clsx(board.toolbar, projectHeaderLayout.toolbar)}>
							{view === "graph" ? (
								<>
									<DirectionSwitch
										direction={settings.graphDirection}
										onChange={(next) =>
											saveView({ ...settings, graphDirection: next })
										}
									/>
									<GraphTools
										probeId="project-graph-viewport"
										fitId="project-graph-fit"
										scope="#project-graph"
										styles="header"
									/>
								</>
							) : null}
							<FilterMenu
								report={report}
								view={settings}
								open={filterOpen}
								onOpen={setFilterOpen}
								onChange={saveView}
							/>
							<input
								id="project-search"
								className={clsx(headerControlStyle.control, board.find)}
								type="search"
								aria-label="Search"
								placeholder="Search"
								value={settings.search}
								onChange={(event) =>
									saveView({ ...settings, search: event.target.value })
								}
							/>
							<Dropdown
								id="project-group"
								label="Group by"
								style={headerControlStyle.control}
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
								<legend className={clsx(frame.legend)}>Views</legend>
								{views.map((item) => (
									<button
										key={item.id}
										type="button"
										id={`view-${item.id}`}
										className={clsx(
											headerControlStyle.segment,
											shell.buttonFocus,
											view === item.id && headerControlStyle.segmentOn,
										)}
										aria-pressed={view === item.id}
										onClick={() => {
											if (!isPageView(item.id)) {
												return;
											}
											saveView({ ...settings, lastView: item.id }, item.id);
										}}
									>
										{item.label}
									</button>
								))}
							</fieldset>
						</div>
					</div>
					<div
						data-project={report.name}
						data-open-view={view}
						data-group-by={
							view === "graph" ? graphGroupBy(settings) : boardGroupBy(settings)
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
								selected={open ? ticket : null}
								onOpen={openTicketInPanel}
								onOpenOutside={openOutsideInPanel}
							/>
						) : view === "table" ? (
							<TicketTable
								report={report}
								groupBy={boardGroupBy(settings)}
								selected={open ? ticket : null}
								onOpen={openTicketInPanel}
								onOpenOutside={openOutsideInPanel}
							/>
						) : view === "graph" ? (
							<ProjectGraph
								report={report}
								reports={outsideReports}
								direction={settings.graphDirection}
								groupBy={graphGroupBy(settings)}
								assignees={settings.assignees}
								openKey={open ? ticket : null}
								onOpen={(node) => {
									if (node.outside) {
										openOutsideInPanel(node, node.state);
										return;
									}
									openTicketInPanel(node.key);
								}}
							/>
						) : (
							<p className={clsx(board.placeholder)}>{view}</p>
						)}
						{open && ticket !== null ? (
							<TicketPanel
								key={`${panelTracker}:${panelProject}:${ticket}`}
								tracker={panelTracker}
								project={panelProject}
								ticketKey={ticket}
								{...(selected?.title === undefined
									? {}
									: { title: selected.title })}
								url={
									selected?.key === undefined || selected.key === null
										? undefined
										: trackerUrl(panelTracker, selected.key)
								}
								{...(selected?.state !== undefined
									? { state: selected.state }
									: openedState === null
										? {}
										: { state: openedState })}
								lane={selected?.lane}
								laneColour={
									report.lanes.find((lane) => lane.name === selected?.lane)
										?.colour
								}
								blockers={incoming}
								blocks={outgoing}
								item={panelItem(
									source,
									panelTracker,
									panelProject,
									ticket,
									active,
								)}
								onOpenBlocker={(blocker) => {
									setPanelReport(null);
									setPanelProject(blocker.project);
									setPanelTracker(blocker.tracker);
									setTicket(blocker.key);
									setOpen(true);
								}}
								onClose={() => {
									clearTicketQuery();
									closeTicket();
									setOpen(false);
								}}
							/>
						) : null}
					</div>
				</main>
			</AppShell>
		</ReactFlowProvider>
	);
}

function mount(): void {
	if (!window.location.pathname.startsWith("/projects/")) {
		return;
	}
	mountPage((root) => {
		root.render(<Page key={projectName()} />);
	});
}

if (typeof document !== "undefined") {
	window.addEventListener("project-flow-page", mount);
	mount();
}
