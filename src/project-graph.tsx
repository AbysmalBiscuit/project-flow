import { BaseEdge } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { board } from "./board-styles.ts";
import { useCollapse } from "./collapse.ts";
import {
	focusChain,
	type ProjectReport,
	parentChip,
	type TicketState,
} from "./domain.ts";
import { Legend } from "./graph-float.tsx";
import { type FlowTicket, graphTickets, projectNodeId } from "./graph-flow.ts";
import { type Anchor, useLaidGraph } from "./graph-laid.tsx";
import {
	focusLinks,
	focusSeeds,
	type LayoutCard,
	layoutInput,
} from "./graph-layout.ts";
import { useNodeSpan } from "./graph-node-size.tsx";
import { FrameTools, ScopeLine } from "./graph-scope.tsx";
import { nodeSize } from "./graph-sizes.ts";
import { DirectionSwitch, LayoutSwitch } from "./graph-switches.tsx";
import {
	drawnLink,
	GraphPending,
	GraphView,
	type LinkProps,
} from "./graph-view.tsx";
import { outsideKey } from "./ticket-key.ts";
import {
	FrameToggleContext,
	shortTicket,
	type TicketCard,
	TicketNode,
} from "./ticket-node.tsx";
import { clsx } from "./ui.ts";
import { cards } from "./ui-styles.ts";
import type {
	GraphDirection,
	GraphLayoutKind,
	GroupBy,
} from "./view-settings.ts";

export type OpenedNode = {
	key: string;
	project: string;
	tracker: "github" | "linear";
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

function seedLabel(
	report: ProjectReport,
	shown: ReadonlyMap<string, string>,
	seed: string,
): string {
	const label = shown.get(seed);
	if (label !== undefined) {
		return label;
	}
	const key =
		report.tickets.find(
			(item) =>
				item.key !== null && projectNodeId(report.name, item.key) === seed,
		)?.key ?? null;
	return key === null
		? seed.slice(seed.indexOf("\n") + 1)
		: shortTicket(key, report.name, false);
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
	focus,
	onOpen,
	onFocus,
	onClearFocus,
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
	focus: ReadonlySet<string>;
	onOpen: (ticket: OpenedNode) => void;
	onFocus: (nodeId: string) => void;
	onClearFocus: () => void;
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
	const source = useMemo(() => ({ report, groupBy }), [report, groupBy]);
	const { laid, failed } = useLaidGraph(
		source,
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
				laid === null
					? []
					: graphTickets(laid.of.report, true, reports).map((ticket) => [
							projectNodeId(ticket.project, ticket.key),
							ticket,
						]),
			),
		[laid, reports],
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
		const parentLabel = parentLabelOf(ticket, laid.of.report);
		return {
			key: ticket.key,
			ticketId: card.ticket,
			ticket,
			...(parentLabel === undefined ? {} : { parentLabel }),
			open: openKey === ticket.key,
			hierarchyChips:
				laid.of.groupBy === "assignee" || laid.of.groupBy === "none",
			frame: card.collapsed ? "collapsed" : heads.has(card.id) ? "open" : null,
		};
	};
	const shownLabels = new Map(
		shownCards.map(({ card, ticket }) => [
			card.ticket,
			shortTicket(ticket.key, ticket.project, ticket.outside),
		]),
	);
	const toScope = (frames: "collapse" | "keep", clearFocus: boolean) => {
		anchor.current = null;
		if (frames === "collapse") {
			collapse.setAll(laid.input.parents, true);
		}
		if (clearFocus) {
			onClearFocus();
		}
		setRefit((count) => count + 1);
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
				card={cardData}
				link={(item) => ({ done: item.done === true })}
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
				overlay={
					<>
						<Legend />
						<ScopeLine
							project={report.name}
							openFrames={laid.input.frames.length}
							focus={[...focus].map((seed) =>
								seedLabel(report, shownLabels, seed),
							)}
							onProject={() => toScope("collapse", true)}
							onFrames={() => toScope("keep", true)}
							onFocus={() => toScope("keep", false)}
						/>
					</>
				}
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
