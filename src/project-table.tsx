import { type ReactNode, useEffect, useState } from "react";

import { board } from "./board-styles.ts";
import {
	BlockerChips,
	Chip,
	relationSplit,
	ServerChips,
} from "./card-chips.tsx";
import { useCollapse } from "./collapse.ts";
import { control } from "./control-styles.ts";
import type { ProjectReport, TicketRelation, TicketView } from "./domain.ts";
import { displayedLaneName } from "./lane-views.ts";
import { QueuedChip } from "./run-marks.tsx";
import { tonedProps } from "./state-tone.ts";
import { tableTree } from "./table-tree-styles.ts";
import { navLabel, subTicketsToggleLabel } from "./terms.ts";
import { ticketGroups } from "./ticket-groups.ts";
import { foldKey, itemId, shortKey } from "./ticket-key.ts";
import { type TreeRow, treeRows } from "./ticket-tree.ts";
import { clsx } from "./ui.ts";
import type { GroupBy } from "./view-settings.ts";

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
			className={clsx(tableTree.toggle, control.clear, control.focus)}
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
			className={clsx(
				board.row,
				control.clear,
				control.focus,
				selected && control.chosen,
			)}
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
				{ticket.chips === undefined && ticket.queued === undefined ? null : (
					<span className={clsx(board.links)}>
						{ticket.queued === undefined ? null : (
							<QueuedChip queued={ticket.queued} />
						)}
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

export function TicketTable({
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
										className={clsx(
											board.sort,
											control.clear,
											control.bleed,
											control.focus,
										)}
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
