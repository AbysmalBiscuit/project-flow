import type { StyleXStyles } from "@stylexjs/stylex";
import {
	Background,
	BackgroundVariant,
	type EdgeProps,
	type EdgeTypes,
	type Edge as FlowEdge,
	type Node as FlowNode,
	Handle,
	type NodeProps,
	type NodeTypes,
	Position,
	ReactFlow,
} from "@xyflow/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { board } from "./board-styles.ts";
import { useClickOrDouble } from "./focus.ts";
import { float } from "./graph-float.tsx";
import { FitLayout, type LaidGraph } from "./graph-laid.tsx";
import type { LaidLink } from "./graph-lanes.ts";
import type { LayoutCard } from "./graph-layout.ts";
import { GraphTools } from "./graph-pane.tsx";
import {
	fitPadding,
	OverlayProbe,
	overlayFit,
	watchLayout,
} from "./graph-probes.tsx";
import {
	markerEnd,
	measureMarker,
	type RoutedEdge,
	routeEdge,
} from "./graph-routes.ts";
import { sizedNode } from "./graph-sizes.ts";
import { graphLayoutFailedLabel } from "./terms.ts";
import { pageTheme, watchPageTheme } from "./theme.ts";
import { classToken, clsx } from "./ui.ts";
import { cards, panel } from "./ui-styles.ts";

/** A group frame, or with `head` the frame of the parent ticket with that key. */
export type ClusterData = {
	label: string;
	members: string[];
	head?: string;
};

type ClusterNode = FlowNode<ClusterData, "cluster">;

/** The props of the card renderer that a page passes to the graph view. */
export type CardProps<Data extends Record<string, unknown>> = NodeProps<
	FlowNode<Data, "card">
>;

/**
 * The data of each arrow: its lane and label spot, the page data, and
 * whether the focus chain fades it or lights it.
 */
export type ViewLink<Data> = LaidLink &
	Data & {
		faded: boolean;
		lit: boolean;
	};

/** The props of the arrow renderer that a page passes to the graph view. */
export type LinkProps<Data extends Record<string, unknown>> = EdgeProps<
	FlowEdge<ViewLink<Data>>
>;

/** The path of an arrow around the cards in its way, and its label spot. */
export function drawnLink<Data extends Record<string, unknown>>({
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	data,
}: LinkProps<Data>): RoutedEdge {
	const label = data?.label ?? { x: 0, y: 0 };
	if (data?.straight !== undefined) {
		return { path: data.straight, labelX: label.x, labelY: label.y };
	}
	return routeEdge(
		{ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition },
		data?.lane ?? 0,
		data?.lanes ?? 1,
		data?.nodes ?? [],
		label,
		data?.entry ?? 0,
		data?.entries ?? 1,
		data?.side,
	);
}

/** The arrow ends of a card, for both graph directions. */
export function CardHandles() {
	return (
		<>
			<Handle type="target" position={Position.Left} id="left" />
			<Handle type="target" position={Position.Top} id="top" />
			<Handle type="source" position={Position.Right} id="right" />
			<Handle type="source" position={Position.Bottom} id="bottom" />
		</>
	);
}

function Cluster({ data }: NodeProps<ClusterNode>) {
	if (data.head !== undefined) {
		return <div className={clsx(board.cluster)} data-frame={data.head} />;
	}
	return (
		<div className={clsx(board.cluster)} data-group={data.label}>
			{data.label}
		</div>
	);
}

function clusterNode(
	id: string,
	box: { x: number; y: number; width: number; height: number },
	data: ClusterData,
): ClusterNode {
	return {
		id,
		type: "cluster",
		position: { x: box.x, y: box.y },
		width: box.width,
		height: box.height,
		style: { width: box.width, height: box.height },
		data,
		zIndex: -1,
		draggable: false,
		selectable: false,
	};
}

/** The group frames, then the parent ticket frames from the outermost in. */
function clusterNodes(
	laid: LaidGraph<unknown>,
	keyOf: ReadonlyMap<string, string>,
): ClusterNode[] {
	const { input, layout } = laid;
	const groups = input.groups.flatMap((group) => {
		const box = layout.groups.get(group.id);
		return box === undefined
			? []
			: [
					clusterNode(group.id, box, {
						label: group.label,
						members: input.cards.flatMap((card) =>
							card.group === group.id ? [card.ticket] : [],
						),
					}),
				];
	});
	const holderOf = new Map<string, string | null>([
		...input.cards.map((card) => [card.id, card.frame] as const),
		...input.frames.map((frame) => [frame.id, frame.parent] as const),
	]);
	const holdersOf = (id: string): string[] => {
		const holders: string[] = [];
		for (let above = holderOf.get(id); above != null; ) {
			holders.push(above);
			above = holderOf.get(above);
		}
		return holders;
	};
	const frames = [...input.frames]
		.sort(
			(left, right) => holdersOf(left.id).length - holdersOf(right.id).length,
		)
		.flatMap((frame) => {
			const box = layout.frames.get(frame.id);
			return box === undefined
				? []
				: [
						clusterNode(frame.id, box, {
							label: "",
							head: keyOf.get(frame.head) ?? frame.head,
							members: input.cards.flatMap((card) =>
								card.id === frame.head || holdersOf(card.id).includes(frame.id)
									? [card.ticket]
									: [],
							),
						}),
					];
		});
	return [...groups, ...frames];
}

function useMarkers() {
	const [theme, setTheme] = useState(pageTheme);
	useEffect(() => watchPageTheme(setTheme), []);
	return useMemo(() => {
		void theme;
		const solid = measureMarker(classToken(cards.graphMarker));
		const done = measureMarker(classToken(board.graphDoneMarker));
		return {
			solid: markerEnd(solid.size, solid.color),
			done: markerEnd(done.size, done.color),
		};
	}, [theme]);
}

/** The graph box before a layout lands, with an alert when the layout failed. */
export function GraphPending({
	root,
	className,
	failed,
}: {
	root: string;
	className: StyleXStyles;
	failed: boolean;
}) {
	return (
		<div id={root} className={clsx(className)}>
			{failed ? (
				<p className={clsx(panel.error)} role="alert">
					{graphLayoutFailedLabel}
				</p>
			) : null}
		</div>
	);
}

/**
 * Draws a laid graph with the page's `Card` and `Link` renderers, and fades
 * what lies outside the focus `chain`. A card or arrow with no page data
 * stays off the graph.
 */
export function GraphView<
	Source,
	CardData extends Record<string, unknown> & { key: string },
	LinkData extends Record<string, unknown>,
>({
	root,
	probe,
	className,
	laid,
	card,
	link,
	Card,
	Link,
	chain,
	refit,
	onOpen,
	onFocus,
	onPreview,
	onPreviewEnd,
	overlay,
	tools,
	moreTools,
	probes,
}: {
	/** The id of the graph box. */
	root: string;
	/** The id prefix of the probes, the pane and the controls. */
	probe: string;
	className: StyleXStyles;
	laid: LaidGraph<Source>;
	card: (card: LayoutCard) => CardData | null;
	link: (link: LaidLink) => LinkData | null;
	Card: NodeTypes[string];
	Link: EdgeTypes[string];
	chain: ReadonlySet<string> | null;
	refit: number;
	onOpen: (card: CardData) => void;
	onFocus: (ticket: string) => void;
	onPreview: (ticket: string) => void;
	onPreviewEnd: () => void;
	overlay?: ReactNode;
	tools?: ReactNode;
	moreTools?: ReactNode;
	probes?: ReactNode;
}) {
	const nodeTypes = useMemo(() => ({ card: Card, cluster: Cluster }), [Card]);
	const edgeTypes = useMemo(() => ({ link: Link }), [Link]);
	const markers = useMarkers();
	const paneId = `${probe}-pane`;
	const fit = useCallback(() => overlayFit(paneId), [paneId]);
	const clicks = useClickOrDouble();
	useEffect(() => watchLayout(root, probe), [root, probe]);
	const horizontal = laid.direction === "left-to-right";
	const kept = (ticket: string) => chain === null || chain.has(ticket);
	const moves = clsx(board.moves);
	const movesFaded = clsx(board.moves, board.faded);
	const shown = laid.input.cards.flatMap((item) => {
		const data = card(item);
		return data === null ? [] : [{ item, data }];
	});
	const ticketOf = new Map(shown.map(({ item }) => [item.id, item.ticket]));
	const cardNodes = shown.map(({ item, data }) =>
		sizedNode<FlowNode<CardData, "card">>(
			{
				id: item.id,
				type: "card",
				position: laid.layout.cards.get(item.id) ?? { x: 0, y: 0 },
				sourcePosition: horizontal ? Position.Right : Position.Bottom,
				targetPosition: horizontal ? Position.Left : Position.Top,
				data,
				className: kept(item.ticket) ? moves : movesFaded,
			},
			laid.sizes.get(item.id) ?? laid.card,
		),
	);
	const clusters = clusterNodes(
		laid,
		new Map(shown.map(({ item, data }) => [item.id, data.key])),
	).map((node) => ({
		...node,
		className:
			chain === null || node.data.members.some((id) => chain.has(id))
				? moves
				: movesFaded,
	}));
	const nodes = [...clusters, ...cardNodes];
	const fades = clsx(board.fades);
	const faded = clsx(board.fades, board.faded);
	const edges = laid.links.flatMap((item): FlowEdge<ViewLink<LinkData>>[] => {
		const from = ticketOf.get(item.from);
		const to = ticketOf.get(item.to);
		const data = link(item);
		if (from === undefined || to === undefined || data === null) {
			return [];
		}
		const lit = kept(from) && kept(to);
		const done = item.done === true;
		return [
			{
				id: item.id,
				source: item.from,
				target: item.to,
				sourceHandle: horizontal ? "right" : "bottom",
				targetHandle: horizontal ? "left" : "top",
				type: "link",
				markerEnd: done ? markers.done : markers.solid,
				className: done
					? `${classToken(board.graphEdgeDone)} ${lit ? fades : faded}`
					: lit
						? fades
						: faded,
				data: { ...item, ...data, faded: !lit, lit: chain !== null && lit },
			},
		];
	});
	const drawn = `${laid.kind} ${laid.direction}`;
	const places = nodes
		.map(
			(node) =>
				`${node.id.replaceAll("\n", " ")} ${node.position.x},${node.position.y}`,
		)
		.join(" | ");
	return (
		<div id={root} className={clsx(className)}>
			<p id={`${probe}-focus`} className={clsx(cards.graphProbe)}>
				{chain === null
					? "focus none"
					: `focus ${[...chain]
							.sort()
							.map((id) => id.replace("\n", " "))
							.join(" | ")}`}
			</p>
			<p id={`${probe}-places`} className={clsx(cards.graphProbe)}>
				{places}
			</p>
			<p id={`${probe}-direction`} className={clsx(cards.graphProbe)}>
				{laid.direction}
			</p>
			<p id={`${probe}-engine`} className={clsx(cards.graphProbe)}>
				{laid.kind}
			</p>
			<p id={`${probe}-layout`} className={clsx(cards.graphProbe)} />
			{probes}
			<div id={paneId} className={clsx(board.graphPane, float.pane)}>
				<ReactFlow
					key={drawn}
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes}
					edgeTypes={edgeTypes}
					nodesDraggable={false}
					nodesConnectable={false}
					nodesFocusable={false}
					elementsSelectable={false}
					panOnDrag
					zoomOnDoubleClick={false}
					fitView
					minZoom={0.1}
					fitViewOptions={{ padding: fitPadding, maxZoom: 1 }}
					proOptions={{ hideAttribution: true }}
					onNodeMouseEnter={(_event, node) => {
						const ticket = ticketOf.get(node.id);
						if (ticket !== undefined) {
							onPreview(ticket);
						}
					}}
					onNodeMouseLeave={onPreviewEnd}
					onNodeDoubleClick={(_event, node) => {
						const ticket = ticketOf.get(node.id);
						if (ticket !== undefined) {
							clicks.double(() => onFocus(ticket));
						}
					}}
					onNodeClick={(event, node) => {
						const ticket = ticketOf.get(node.id);
						if (node.type !== "card" || ticket === undefined) {
							return;
						}
						clicks.click(
							event,
							() => onFocus(ticket),
							() => onOpen(node.data),
						);
					}}
				>
					<Background variant={BackgroundVariant.Dots} gap={18} />
					<FitLayout
						key={drawn}
						layout={laid.layout}
						held={laid.held}
						refit={refit}
						fit={fit}
					/>
					<OverlayProbe probe={probe} paneId={paneId} />
				</ReactFlow>
				{overlay === undefined ? null : (
					<div className={clsx(float.overlay)} data-graph-overlay="">
						{overlay}
					</div>
				)}
				<div id={`${probe}-controls`} className={clsx(float.corner)}>
					<div className={clsx(float.group)}>
						{tools}
						<GraphTools
							probeId={`${probe}-viewport`}
							fitId={`${probe}-fit`}
							scope={`#${root}`}
							fitOptions={fit}
						/>
						{moreTools}
					</div>
				</div>
			</div>
		</div>
	);
}
