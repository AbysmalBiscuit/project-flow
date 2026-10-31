import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useState } from "react";

import { board } from "./board-styles.ts";
import { Button } from "./button.tsx";
import { OutsideParentsContext } from "./card-chips.tsx";
import type { ProjectViewSettings } from "./configuration.ts";
import { useTicketMenu } from "./context-menu.tsx";
import { control } from "./control-styles.ts";
import type {
	OutsideParent,
	ProjectReport,
	StatusType,
	TicketRelation,
	TicketView,
} from "./domain.ts";
import { clickCard, type ClickKeys } from "./focus.ts";
import { displayedLaneName, doneTicketsForLane } from "./lane-views.ts";
import { openPage, runPagePath } from "./page-links.ts";
import { useLaneColour } from "./state-colours.ts";
import { tonedProps } from "./state-tone.ts";
import { openParentLabel, stateLabel } from "./terms.ts";
import { TicketCardBody } from "./ticket-card.tsx";
import { parentChip, ticketGroups } from "./ticket-groups.ts";
import { outsideKey, sameTicketKey, shortKey } from "./ticket-key.ts";
import { clsx } from "./ui.ts";
import {
	defaultGroupBy,
	type GroupBy,
	visibleLaneNames,
} from "./view-settings.ts";

const doneCap = 5;

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

export function boardGroupBy(settings: ProjectViewSettings): GroupBy {
	return settings.groupBy ?? defaultGroupBy;
}

function laneTickets(report: ProjectReport, lane: string): TicketView[] {
	return report.tickets.filter((ticket) => displayedLaneName(ticket) === lane);
}

export type TicketFocus = {
	active: boolean;
	faded: (key: string | null) => boolean;
	toggle: (key: string) => void;
	enter: (key: string) => void;
	leave: () => void;
};

export const TicketFocusContext = createContext<TicketFocus>({
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
					control.focus,
					board.toned,
					control.tonedCard,
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
		control.focus,
		known !== undefined && board.toned,
		control.card,
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

export function Board({
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
