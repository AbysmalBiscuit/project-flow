import * as stylex from "@stylexjs/stylex";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	Handle,
	type Node,
	type NodeProps,
	Position,
} from "@xyflow/react";
import { ChevronRight } from "lucide-react";

import { board } from "./board-styles.ts";
import { Button } from "./button.tsx";
import type { Point } from "./graph-core.ts";
import type { LaidEdge } from "./graph-workflow.ts";
import { inset, insetOf, Outline, roleStrokeOf } from "./run-graph-outline.tsx";
import { StageCard, type StageFacts, stageStroke } from "./run-stage.tsx";
import {
	calledGraphLabel,
	callsGraphLabel,
	openSubgraphLabel,
	stageKindLabel,
} from "./run-terms.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

export const nodeStyles = stylex.create({
	stage: {
		position: "relative",
		display: "flex",
		cursor: "pointer",
		alignItems: "center",
		boxSizing: "border-box",
		width: "100%",
		height: "100%",
	},
	outline: {
		position: "absolute",
		inset: 0,
		overflow: "visible",
		width: "100%",
		height: "100%",
	},
	body: {
		position: "relative",
		minWidth: 0,
		width: "100%",
	},
	opens: {
		cursor: "pointer",
	},
	toggle: {
		position: "absolute",
		top: `calc(-1 * ${space.sm})`,
		right: `calc(-1 * ${space.sm})`,
	},
	opensButton: {
		position: "absolute",
		top: `calc(-1 * ${measure.glyph} / 2)`,
		right: `calc(-1 * ${measure.glyph} / 2)`,
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		boxSizing: "border-box",
		width: measure.glyph,
		height: measure.glyph,
		padding: 0,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.pill,
		backgroundColor: {
			default: colours.surface,
			":hover": colours.surfaceMuted,
		},
		color: colours.ink,
		cursor: "pointer",
		outlineWidth: measure.focus,
		outlineStyle: { default: "none", ":focus-visible": "solid" },
		outlineColor: colours.focus,
	},
	opensIcon: {
		width: measure.sortMark,
		height: measure.sortMark,
	},
	opensRoom: {
		paddingInline: `calc(${measure.glyph} / 2)`,
	},
	frame: {
		boxSizing: "border-box",
		width: "100%",
		height: "100%",
		borderWidth: measure.hairline,
		borderStyle: "dashed",
		borderColor: colours.groupLine,
		borderRadius: radius.md,
		backgroundColor: colours.groupFill,
	},
	handle: {
		opacity: 0,
	},
	edgeText: {
		position: "absolute",
		paddingInline: space.twoXs,
		borderRadius: radius.sm,
		backgroundColor: colours.raised,
		color: colours.inkMuted,
		fontSize: type.meta,
		lineHeight: type.line,
		whiteSpace: "nowrap",
		pointerEvents: "all",
	},
	legendRow: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	glyph: {
		flexShrink: 0,
		overflow: "visible",
		width: measure.icon,
		height: measure.glyph,
	},
	legendText: {
		position: "static",
	},
	roleCard: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		minWidth: 0,
		textAlign: "center",
	},
	roleLabel: {
		maxWidth: "100%",
		overflow: "hidden",
		color: colours.ink,
		fontSize: type.small,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	roleName: {
		color: colours.inkSoft,
		fontSize: type.meta,
	},
});

export type StageNode = Node<
	{
		facts: StageFacts;
		shape: string;
		kind: string;
		child: { open: boolean; toggle: () => void } | null;
		/** Set when the graph shows the agent role of each stage instead of its run state. */
		role: { name: string | undefined } | null;
		/** The graph file that the stage calls, and the action that opens it. */
		opens: { graph: string; open: () => void } | null;
	},
	"stage"
>;

export type FrameNode = Node<Record<string, never>, "frame">;

export type RouteEdge = Edge<
	Pick<LaidEdge, "points" | "text" | "condition"> & { faded: boolean },
	"route"
>;

function Stage({
	data: { facts, shape, kind, child, role, opens },
}: NodeProps<StageNode>) {
	return (
		<div
			className={clsx(
				nodeStyles.stage,
				inset[insetOf[shape] ?? "box"],
				opens !== null && nodeStyles.opens,
			)}
			title={opens === null ? undefined : callsGraphLabel(opens.graph)}
			data-opens={opens?.graph}
			data-shape={shape}
			data-kind={kind}
			data-role={role?.name}
			data-child={child === null ? undefined : child.open ? "open" : "closed"}
		>
			<Handle
				type="target"
				position={Position.Top}
				className={clsx(nodeStyles.handle)}
			/>
			<Outline
				shape={shape}
				stroke={
					role === null
						? stageStroke[facts.stage.state]
						: roleStrokeOf(role.name)
				}
				layout={nodeStyles.outline}
			/>
			<span className={clsx(nodeStyles.body)}>
				{role === null ? (
					<StageCard facts={facts} />
				) : (
					<span
						className={clsx(
							nodeStyles.roleCard,
							opens !== null && nodeStyles.opensRoom,
						)}
						title={facts.stage.label}
					>
						<span className={clsx(nodeStyles.roleLabel)}>
							{facts.stage.label}
						</span>
						<span className={clsx(nodeStyles.roleName)}>
							{role.name ?? stageKindLabel(kind)}
						</span>
					</span>
				)}
			</span>
			{opens === null ? null : (
				<button
					type="button"
					className={`nodrag nopan ${clsx(nodeStyles.opensButton)}`}
					title={openSubgraphLabel(opens.graph)}
					aria-label={openSubgraphLabel(opens.graph)}
					onClick={(event) => {
						event.stopPropagation();
						opens.open();
					}}
				>
					<ChevronRight className={clsx(nodeStyles.opensIcon)} aria-hidden />
				</button>
			)}
			{child === null ? null : (
				<span className={`nodrag nopan ${clsx(nodeStyles.toggle)}`}>
					<Button
						icon={child.open ? "shrink" : "expand"}
						name={calledGraphLabel(child.open, facts.stage.label)}
						pressed={child.open}
						onClick={(event) => {
							event.stopPropagation();
							child.toggle();
						}}
					/>
				</span>
			)}
			<Handle
				type="source"
				position={Position.Bottom}
				className={clsx(nodeStyles.handle)}
			/>
		</div>
	);
}

function Frame() {
	return (
		<div className={clsx(nodeStyles.frame)}>
			<Handle
				type="target"
				position={Position.Top}
				className={clsx(nodeStyles.handle)}
			/>
			<Handle
				type="source"
				position={Position.Bottom}
				className={clsx(nodeStyles.handle)}
			/>
		</div>
	);
}

function pathOf(points: readonly Point[]): string {
	return points
		.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
		.join(" ");
}

/** An edge along the route that ELK laid out, with its text where ELK placed it. */
function Route({ id, data, markerEnd }: EdgeProps<RouteEdge>) {
	const text = data?.text;
	return (
		<>
			<BaseEdge
				id={id}
				path={pathOf(data?.points ?? [])}
				{...(markerEnd === undefined ? {} : { markerEnd })}
			/>
			{text === undefined ? null : (
				<EdgeLabelRenderer>
					<span
						className={clsx(
							nodeStyles.edgeText,
							board.fades,
							data?.faded === true && board.faded,
						)}
						data-edge-text={text.text}
						title={data?.condition}
						style={{
							transform: `translate(-50%, -50%) translate(${text.x + text.width / 2}px, ${text.y + text.height / 2}px)`,
						}}
					>
						{text.text}
					</span>
				</EdgeLabelRenderer>
			)}
		</>
	);
}

export const nodeTypes = { stage: Stage, frame: Frame };
export const edgeTypes = { route: Route };
