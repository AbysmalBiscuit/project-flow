import { BaseEdge, EdgeLabelRenderer } from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";

import { useTrackerLabel } from "./backend-labels.ts";
import { board } from "./board-styles.ts";
import { control } from "./control-styles.ts";
import type { CrossProjectBlocker, ProjectCounts } from "./domain.ts";
import { type FocusView, shownSeeds } from "./focus.ts";
import { type Anchor, useLaidGraph } from "./graph-laid.tsx";
import { focusLinks, type LayoutInput } from "./graph-layout.ts";
import { MeasuredNode, useNodeSpan } from "./graph-node-size.tsx";
import {
	CardHandles,
	type CardProps,
	drawnLink,
	GraphPending,
	GraphView,
	type LinkProps,
} from "./graph-view.tsx";
import { focusChain } from "./links.ts";
import { Loading } from "./loading.tsx";
import { openProject, projectPath } from "./paths.ts";
import { SegmentedBar, ticketTotal } from "./progress-bar.tsx";
import { overviewControlLabel } from "./terms.ts";
import { linkId, ticketRefId } from "./ticket-key.ts";
import { cards } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

/** Projects sit farther apart than tickets, so each arrow label fits between them. */
const projectGap = { along: 360, across: 168 };

/** The id of the arrow for one cross-project blocker on the overview graph. */
function blockerLinkId(blocked: string, blocker: CrossProjectBlocker) {
	return linkId(blocked, ticketRefId(blocker));
}

/**
 * The overview graph: one card per project, and one arrow per ticket that
 * blocks a ticket of another shown project.
 */
function overviewInput(projects: readonly ProjectCounts[]): LayoutInput {
	const shown = new Set(projects.map((project) => project.name));
	return {
		cards: projects.map((project) => ({
			id: project.name,
			ticket: project.name,
			group: null,
			frame: null,
			collapsed: false,
		})),
		groups: [],
		frames: [],
		edges: projects.flatMap((project) =>
			project.crossProjectBlockers.flatMap((blocker) =>
				shown.has(blocker.project) && blocker.project !== project.name
					? [
							{
								id: blockerLinkId(project.name, blocker),
								from: blocker.project,
								to: project.name,
							},
						]
					: [],
			),
		),
		hiddenIn: new Map(),
		parents: [],
	};
}

type ProjectCard = { key: string; project: ProjectCounts };

type BlockerLink = {
	ticket: string;
	blocked: string;
	blocker: string;
	tracker: CrossProjectBlocker["tracker"];
};

function ProjectNode({ id, data }: CardProps<ProjectCard>) {
	const { project } = data;
	const trackerName = useTrackerLabel();
	return (
		<a
			className={clsx(
				cards.graphNode,
				cards.graphCard,
				control.graphCard,
				control.focus,
				project.needsYou > 0 && cards.graphNeedsYou,
			)}
			href={projectPath(project.name)}
			id={`graph-card-${id}`}
			aria-label={project.name}
			data-project={project.name}
			onClick={(event) => event.preventDefault()}
		>
			<MeasuredNode id={id} kind="project" />
			<CardHandles />
			<p className={clsx(cards.graphTitle)}>{project.name}</p>
			{project.needsYou > 0 ? (
				<span className={clsx(board.chips, board.chipsRow, cards.graphChips)}>
					<span className={clsx(board.chip, board.chipNeeds)}>
						{project.needsYou === 1
							? overviewControlLabel.needsYouOne
							: `${project.needsYou} ${overviewControlLabel.needsYouMany}`}
					</span>
				</span>
			) : null}
			<p className={clsx(cards.graphMeta)}>{trackerName(project.tracker)}</p>
			{project.pending === true ? (
				<Loading />
			) : (
				<>
					<SegmentedBar project={project} />
					<p className={clsx(cards.graphCount)}>
						{project.done} of {ticketTotal(project)} done
					</p>
				</>
			)}
		</a>
	);
}

function BlockerEdge(props: LinkProps<BlockerLink>) {
	const { id, markerEnd, data } = props;
	const drawn = drawnLink(props);
	if (data === undefined) {
		return null;
	}
	return (
		<>
			<BaseEdge
				id={id}
				path={drawn.path}
				{...(markerEnd === undefined ? {} : { markerEnd })}
			/>
			<EdgeLabelRenderer>
				<button
					type="button"
					className={`nopan ${clsx(
						cards.graphEdge,
						control.clear,
						control.bleed,
						control.focus,
						cards.graphLabel,
						board.fades,
						data.faded && board.faded,
					)}`}
					style={{
						transform: `translate(-50%, -50%) translate(${drawn.labelX}px, ${drawn.labelY}px)`,
					}}
					aria-label={`${data.ticket} ${data.blocked}`}
					onClick={() => {
						openProject(data.blocked, {
							tracker: data.tracker,
							project: data.blocker,
							key: data.ticket,
						});
					}}
				>
					{data.ticket}
				</button>
			</EdgeLabelRenderer>
		</>
	);
}

export function OverviewGraph({
	projects,
	focus,
}: {
	projects: ProjectCounts[];
	focus: FocusView;
}) {
	const clearFocus = focus.clear;
	useEffect(() => clearFocus, [clearFocus]);
	const span = useNodeSpan(cards.graphNode, "project", "Project");
	const input = useMemo(() => overviewInput(projects), [projects]);
	const anchor = useRef<Anchor | null>(null);
	const { laid, failed, unplaced } = useLaidGraph(
		input,
		"left-to-right",
		"layered",
		span,
		anchor,
		projectGap,
	);
	const byName = useMemo(
		() => new Map(projects.map((project) => [project.name, project])),
		[projects],
	);
	const blockers = useMemo(
		() =>
			new Map(
				projects.flatMap((project) =>
					project.crossProjectBlockers.map(
						(blocker) =>
							[
								blockerLinkId(project.name, blocker),
								{
									ticket: blocker.key,
									blocked: project.name,
									blocker: blocker.project,
									tracker: blocker.tracker,
								},
							] as const,
					),
				),
			),
		[projects],
	);
	if (laid === null) {
		return (
			<GraphPending
				root="overview-graph"
				className={cards.graph}
				failed={failed}
			/>
		);
	}
	const seeds = shownSeeds(focus.focus, focus.preview);
	const chain =
		seeds.size === 0 ? null : focusChain(seeds, focusLinks(laid.input));
	return (
		<GraphView
			root="overview-graph"
			probe="graph"
			className={cards.graph}
			laid={laid}
			unplaced={unplaced}
			card={(item) => {
				const project = byName.get(item.ticket);
				return project === undefined ? null : { key: project.name, project };
			}}
			link={(item) => blockers.get(item.id) ?? null}
			Card={ProjectNode}
			Link={BlockerEdge}
			chain={chain}
			refit={0}
			onOpen={(item) => openProject(item.project.name)}
			onFocus={focus.toggle}
			onPreview={focus.enter}
			onPreviewEnd={focus.leave}
		/>
	);
}
