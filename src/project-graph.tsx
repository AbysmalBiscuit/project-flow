import { useQuery } from "@tanstack/react-query";
import { BaseEdge } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";

import { board } from "./board-styles.ts";
import { useCollapse } from "./collapse.ts";
import type { ProjectReport, TicketState, TrackerKind } from "./domain.ts";
import { focusChain } from "./focus-chain.ts";
import { LegendFrame } from "./graph-core-view.tsx";
import { type FlowTicket, graphTickets, projectNodeId } from "./graph-flow.ts";
import { type Anchor, useLaidGraph } from "./graph-laid.tsx";
import {
	focusLinks,
	focusSeeds,
	type LayoutCard,
	layoutInput,
} from "./graph-layout.ts";
import { useNodeSpan } from "./graph-node-size.tsx";
import { FrameTools } from "./graph-scope.tsx";
import { nodeSize } from "./graph-sizes.ts";
import { DirectionSwitch, LayoutSwitch } from "./graph-switches.tsx";
import {
	drawnLink,
	GraphPending,
	GraphView,
	type LinkProps,
} from "./graph-view.tsx";
import { pageQuery } from "./queries.ts";
import { tonedProps } from "./state-tone.ts";
import { projectGraphLabel } from "./terms.ts";
import { parentChip } from "./ticket-groups.ts";
import { outsideKey } from "./ticket-key.ts";
import {
	FrameToggleContext,
	shortTicket,
	type TicketCard,
	TicketNode,
} from "./ticket-node.tsx";
import { cards } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import type {
	GraphDirection,
	GraphLayoutKind,
	GroupBy,
} from "./view-settings.ts";

export type OpenedNode = {
	key: string;
	project: string;
	tracker: TrackerKind;
	title: string;
	outside: boolean;
	state?: TicketState;
};

type TicketLink = { done: boolean };

/** An outside ticket names its parent ticket in its own project. */
function parentLabelOf(
	ticket: FlowTicket,
	report: ProjectReport,
): string | undefined {
	if (ticket.parent === undefined) {
		return undefined;
	}
	return ticket.outside
		? outsideKey(ticket.project, ticket.parent)
		: parentChip(report.outsideParents, ticket.parent).label;
}

function TicketEdge(props: LinkProps<TicketLink>) {
	const { id, markerEnd, data } = props;
	const drawn = drawnLink(props).path;
	const done = data?.done === true;
	const flowing = done && data?.lit === true;
	return (
		<g key={drawn} className={clsx(board.edgeEnters)}>
			<BaseEdge
				id={id}
				path={drawn}
				data-flowing={flowing ? "true" : "false"}
				className={
					done
						? clsx(board.graphEdgeDash, flowing && board.graphEdgeFlow)
						: undefined
				}
				{...(markerEnd === undefined ? {} : { markerEnd })}
			/>
		</g>
	);
}

/** The ticket states and arrow marks of the project graph. */
function Legend() {
	const states = useQuery(pageQuery.settings).data?.states ?? [];
	return (
		<LegendFrame id="graph-legend" label={projectGraphLabel.legend}>
			<ul className={clsx(board.legendRow)}>
				{states.map((state) => (
					<li key={state.id} className={clsx(board.legendItem)}>
						<span
							{...tonedProps(state.colour, undefined, board.legendDot)}
							data-state={state.id}
						/>
						{state.label}
					</li>
				))}
			</ul>
			<p className={clsx(board.legendNote, board.legendEdge)}>
				<span className={clsx(board.legendSwatch)} />
				{projectGraphLabel.arrow}
			</p>
			<p className={clsx(board.legendNote, board.legendEdge)}>
				<span className={clsx(board.legendSwatch, board.legendSwatchDone)} />
				{projectGraphLabel.done}
			</p>
			<p className={clsx(board.legendNote)}>{projectGraphLabel.dashed}</p>
		</LegendFrame>
	);
}

export function ProjectGraph({
	report,
	reports,
	direction,
	layout,
	groupBy,
	assignees,
	openKey,
	seeds,
	onOpen,
	onFocus,
	onPreview,
	onPreviewEnd,
	onDirection,
	onLayout,
}: {
	report: ProjectReport;
	reports: ProjectReport[];
	direction: GraphDirection;
	layout: GraphLayoutKind;
	groupBy: GroupBy;
	assignees: readonly string[];
	openKey: string | null;
	seeds: ReadonlySet<string>;
	onOpen: (ticket: OpenedNode) => void;
	onFocus: (nodeId: string) => void;
	onPreview: (nodeId: string) => void;
	onPreviewEnd: () => void;
	onDirection: (direction: GraphDirection) => void;
	onLayout: (layout: GraphLayoutKind) => void;
}) {
	const span = useNodeSpan(board.ticketNode, "ticket", "Ticket");
	const collapse = useCollapse();
	const anchor = useRef<Anchor | null>(null);
	const [refit, setRefit] = useState(0);
	const input = useMemo(
		() => layoutInput(report, groupBy, assignees, collapse.collapsed),
		[report, groupBy, assignees, collapse.collapsed],
	);
	const { laid, failed, unplaced } = useLaidGraph(
		input,
		direction,
		layout,
		span,
		anchor,
	);
	const toggleFrame = useCallback(
		(card: string, key: string, startsCollapsed: boolean) => {
			const at = laid?.layout.cards.get(card);
			anchor.current = at === undefined ? null : { card, at };
			collapse.toggle(key, startsCollapsed);
		},
		[laid, collapse],
	);
	const tickets = useMemo(
		() =>
			new Map(
				graphTickets(report, true, reports).map((ticket) => [
					projectNodeId(ticket.project, ticket.key),
					ticket,
				]),
			),
		[report, reports],
	);
	const doneLinks = useMemo(
		() => new Set(input.edges.flatMap((edge) => (edge.done ? [edge.id] : []))),
		[input],
	);
	if (laid === null) {
		return (
			<GraphPending
				root="project-graph"
				className={board.ticketGraph}
				failed={failed}
			/>
		);
	}
	const chain =
		seeds.size === 0
			? null
			: focusChain(focusSeeds(laid.input, seeds), focusLinks(laid.input));
	const heads = new Set(laid.input.frames.map((frame) => frame.head));
	const shownCards = laid.input.cards.flatMap((card) => {
		const ticket = tickets.get(card.ticket);
		return ticket === undefined ? [] : [{ card, ticket }];
	});
	const keyOf = new Map(
		shownCards.map(({ card, ticket }) => [card.id, ticket.key]),
	);
	const cardData = (card: LayoutCard): TicketCard | null => {
		const ticket = tickets.get(card.ticket);
		if (ticket === undefined) {
			return null;
		}
		const parentLabel = parentLabelOf(ticket, report);
		return {
			key: ticket.key,
			ticketId: card.ticket,
			ticket,
			...(parentLabel === undefined ? {} : { parentLabel }),
			open: openKey === ticket.key,
			hierarchyChips: groupBy === "assignee" || groupBy === "none",
			frame: card.collapsed ? "collapsed" : heads.has(card.id) ? "open" : null,
		};
	};
	const frameBoxes = laid.input.frames.flatMap((frame) => {
		const box = laid.layout.frames.get(frame.id);
		return box === undefined
			? []
			: [
					{
						head: keyOf.get(frame.head) ?? frame.head,
						left: box.x,
						top: box.y,
						right: box.x + box.width,
						bottom: box.y + box.height,
					},
				];
	});
	const framedCards = shownCards.flatMap(({ card, ticket }) => {
		const at = laid.layout.cards.get(card.id) ?? { x: 0, y: 0 };
		const size = nodeSize(card.id, laid.sizes.get(card.id) ?? laid.card);
		const holders = frameBoxes
			.filter(
				(box) =>
					box.head !== ticket.key &&
					box.left <= at.x &&
					box.top <= at.y &&
					at.x + size.width <= box.right &&
					at.y + size.height <= box.bottom,
			)
			.sort(
				(one, other) =>
					(one.right - one.left) * (one.bottom - one.top) -
					(other.right - other.left) * (other.bottom - other.top),
			)
			.map((box) => box.head);
		return holders.length === 0 ? [] : [[ticket.key, ...holders].join(" in ")];
	});
	return (
		<FrameToggleContext value={toggleFrame}>
			<GraphView
				root="project-graph"
				probe="project-graph"
				className={board.ticketGraph}
				laid={laid}
				unplaced={unplaced}
				card={cardData}
				link={(item) => ({ done: doneLinks.has(item.id) })}
				Card={TicketNode}
				Link={TicketEdge}
				chain={chain}
				refit={refit}
				onOpen={({ ticket }) =>
					onOpen({
						key: ticket.key,
						project: ticket.project,
						tracker: ticket.tracker,
						title: ticket.title,
						outside: ticket.outside,
						...(ticket.state === undefined ? {} : { state: ticket.state }),
					})
				}
				runOf={({ ticket }) => ticket.factoryRun?.id}
				onFocus={onFocus}
				onPreview={onPreview}
				onPreviewEnd={onPreviewEnd}
				probes={
					<>
						<p id="project-graph-frames" className={clsx(cards.graphProbe)}>
							{framedCards.sort().join(" | ")}
						</p>
						<p id="project-graph-outside" className={clsx(cards.graphProbe)}>
							{shownCards
								.flatMap(({ ticket }) =>
									ticket.outside
										? [shortTicket(ticket.key, ticket.project, true)]
										: [],
								)
								.join(" | ")}
						</p>
						<p id="project-graph-panel" className={clsx(cards.graphProbe)}>
							{openKey === null ? "panel closed" : "panel open"}
						</p>
						<p id="graph-states" className={clsx(cards.graphProbe)}>
							{shownCards
								.map(
									({ ticket }) => `${ticket.key} ${ticket.state ?? "unknown"}`,
								)
								.join(" | ")}
						</p>
					</>
				}
				overlay={<Legend />}
				tools={
					<>
						<LayoutSwitch layout={layout} onChange={onLayout} />
						<DirectionSwitch
							direction={direction}
							disabled={layout !== "layered"}
							onChange={onDirection}
						/>
					</>
				}
				moreTools={
					<FrameTools
						parents={laid.input.parents.length}
						onAll={(shut) => {
							anchor.current = null;
							collapse.setAll(laid.input.parents, shut);
							setRefit((count) => count + 1);
						}}
					/>
				}
			/>
		</FrameToggleContext>
	);
}
