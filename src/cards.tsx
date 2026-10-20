import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	type Configuration,
	type OverviewView,
	overviewFilters,
	overviewSorts,
	overviewViews,
	sameRef,
} from "./configuration.ts";
import type {
	CrossProjectBlocker,
	NeedsYouItem,
	Overview,
	ProjectCounts,
} from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import { actionLabel } from "./needs-item.tsx";
import {
	askNotificationPermission,
	notificationPermission,
} from "./notify.tsx";
import { PageFrame, type PageView, SearchGlyph } from "./shell.tsx";
import {
	navLabel,
	overviewControlLabel,
	overviewFilterLabel,
	overviewSortLabel,
	stateLabel,
	viewLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards, frame, shell } from "./ui-styles.ts";

function projectPath(name: string, ticket?: string): string {
	const path = `/projects/${encodeURIComponent(name)}`;
	if (ticket === undefined) {
		return path;
	}
	return `${path}?ticket=${encodeURIComponent(ticket)}`;
}

function openProject(name: string, ticket?: string): void {
	window.location.assign(projectPath(name, ticket));
}

function Chip({ blocker }: { blocker: CrossProjectBlocker }) {
	return (
		<a
			className={clsx(cards.chip, cards.chipHover)}
			href={projectPath(blocker.project, blocker.key)}
			onClick={(event) => {
				event.preventDefault();
				window.location.assign(projectPath(blocker.project, blocker.key));
			}}
		>
			Blocked by {blocker.project}#{blocker.key}
		</a>
	);
}

type FilterKey = OverviewView["filter"];
type SortKey = OverviewView["sort"];

function matchesFilter(project: ProjectCounts, filter: FilterKey): boolean {
	if (filter === "needs-you") {
		return project.needsYou > 0;
	}
	if (filter === "blocked") {
		return project.blocked > 0 || project.crossProjectBlockers.length > 0;
	}
	if (filter === "pinned") {
		return project.pinned;
	}
	return true;
}

function matchesSearch(project: ProjectCounts, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") {
		return true;
	}
	const haystack = [
		project.name,
		...project.tags,
		...project.unlinkedPrs.map((pull) => pull.title),
		...project.crossProjectBlockers.map(
			(blocker) => `${blocker.project} ${blocker.key} ${blocker.title}`,
		),
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle);
}

function sortValue(project: ProjectCounts, key: SortKey): number | string {
	if (key === "name") {
		return project.name;
	}
	if (key === "progress") {
		return project.progress;
	}
	if (key === "needs-you") {
		return project.needsYou;
	}
	return project.crossProjectBlockers.length;
}

function sortProjects(
	projects: ProjectCounts[],
	key: SortKey,
): ProjectCounts[] {
	const leastFirst = key === "name" || key === "progress";
	return [...projects].sort((left, right) => {
		const leftValue = sortValue(left, key);
		const rightValue = sortValue(right, key);
		const delta =
			typeof leftValue === "string" || typeof rightValue === "string"
				? String(leftValue).localeCompare(String(rightValue))
				: leftValue - rightValue;
		if (delta !== 0) {
			return leastFirst ? delta : -delta;
		}
		return left.name.localeCompare(right.name);
	});
}

function shownProjects(
	overview: Overview,
	view: OverviewView,
	query: string,
): ProjectCounts[] {
	return sortProjects(
		overview.projects.filter(
			(project) =>
				matchesFilter(project, view.filter) && matchesSearch(project, query),
		),
		view.sort,
	);
}

function polledLine(fetchedAt: string | null, now: number): string | null {
	if (fetchedAt === null) {
		return null;
	}
	const at = Date.parse(fetchedAt);
	if (Number.isNaN(at)) {
		return null;
	}
	const age = Math.max(0, Math.floor((now - at) / 1000));
	return `${overviewControlLabel.polled} ${age} s ago`;
}

function slug(value: string): string {
	const cleaned = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return cleaned === "" ? "item" : cleaned;
}

function trackerName(tracker: ProjectCounts["tracker"]): string {
	return tracker === "linear" ? "Linear" : "GitHub";
}

function subtitle(project: ProjectCounts): string {
	if (project.ref.tracker === "linear") {
		return `${trackerName(project.tracker)}, ${project.ref.project}`;
	}
	if ("repo" in project.ref) {
		return `${trackerName(project.tracker)}, ${project.ref.repo}`;
	}
	return `${trackerName(project.tracker)}, ${project.ref.owner}/${project.ref.project}`;
}

function ticketTotal(project: ProjectCounts): number {
	return (
		project.done +
		project.dropped +
		project.backlog +
		project.inProgress +
		project.inReview +
		project.awaitingMerge
	);
}

const barSegments = [
	{ key: "done", tone: cards.done },
	{ key: "inProgress", tone: cards.inProgress },
	{ key: "inReview", tone: cards.inReview },
	{ key: "awaitingMerge", tone: cards.awaitingMerge },
	{ key: "backlog", tone: cards.backlog },
] as const;

const legendSegments = [
	{ key: "backlog", label: stateLabel.backlog, tone: cards.backlog },
	{ key: "inProgress", label: stateLabel.inProgress, tone: cards.inProgress },
	{ key: "inReview", label: stateLabel.inReview, tone: cards.inReview },
	{
		key: "awaitingMerge",
		label: stateLabel.awaitingMerge,
		tone: cards.awaitingMerge,
	},
] as const;

function SegmentedBar({ project }: { project: ProjectCounts }) {
	const total = ticketTotal(project);
	return (
		<div
			className={clsx(cards.bar)}
			role="progressbar"
			aria-valuenow={project.progress}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label={`${project.name} progress`}
		>
			{total === 0
				? null
				: barSegments.map((item) =>
						project.statusTypes[item.key] === 0 ? null : (
							<div
								key={item.key}
								{...stylex.props(
									cards.segment(
										`${(project.statusTypes[item.key] / total) * 100}%`,
									),
									item.tone,
								)}
							/>
						),
					)}
		</div>
	);
}

function Legend({ project }: { project: ProjectCounts }) {
	return (
		<p className={clsx(cards.counts)}>
			{legendSegments.map((item) =>
				project.statusTypes[item.key] === 0 ? null : (
					<span key={item.key} className={clsx(cards.count)}>
						<span className={clsx(cards.swatch, item.tone)} />
						{item.label} {project.statusTypes[item.key]}
					</span>
				),
			)}
		</p>
	);
}

function PinMark({ on }: { on: boolean }) {
	return (
		<span className={clsx(cards.pin, !on && cards.pinOff)}>
			{on ? "★" : "☆"}
		</span>
	);
}

function ProjectCard({ project }: { project: ProjectCounts }) {
	const id = `project-card-${slug(project.name)}`;
	const total = ticketTotal(project);
	return (
		<li id={id} className={clsx(cards.card)}>
			<div className={clsx(cards.cardTop)}>
				<a
					className={clsx(cards.projectLink)}
					href={projectPath(project.name)}
					aria-label={project.name}
					onClick={(event) => {
						event.preventDefault();
						openProject(project.name);
					}}
				>
					<h2 className={clsx(cards.nameRow)}>
						{project.name} <PinMark on={project.pinned} />
					</h2>
					<p className={clsx(cards.meta)}>{subtitle(project)}</p>
				</a>
				{project.needsYou === 0 ? null : (
					<span className={clsx(cards.badge)}>{project.needsYou} need you</span>
				)}
			</div>
			{project.error === null ? null : (
				<p className={clsx(shell.stale)}>{project.error}</p>
			)}
			<p className={clsx(cards.doneLine)}>
				<span>
					{project.done} of {total} done
				</span>
				<span>{project.progress}%</span>
			</p>
			<SegmentedBar project={project} />
			<Legend project={project} />
			{project.crossProjectBlockers.length === 0 &&
			project.tags.length === 0 &&
			project.unlinkedPrs.length === 0 ? null : (
				<p className={clsx(cards.blockers)}>
					{project.crossProjectBlockers.map((blocker) => (
						<Chip key={`${blocker.project} ${blocker.key}`} blocker={blocker} />
					))}
					{project.tags.map((tag) => (
						<span key={tag} className={clsx(cards.tagChip)}>
							{tag}
						</span>
					))}
					{project.unlinkedPrs.length === 0 ? null : (
						<span className={clsx(cards.quiet)}>
							{project.unlinkedPrs.length} {overviewControlLabel.unlinked}
						</span>
					)}
				</p>
			)}
		</li>
	);
}

function CardsList({ projects }: { projects: ProjectCounts[] }) {
	return (
		<ul className={clsx(cards.list)}>
			{projects.map((project) => (
				<ProjectCard
					key={`${project.tracker}:${project.name}`}
					project={project}
				/>
			))}
		</ul>
	);
}

type GraphEdge = {
	from: string;
	blocker: CrossProjectBlocker;
};

const graphColumnGap = 220;
const graphRowStep = 116;
const graphNodeWidth = 196;
const graphNodeHeight = 92;
const graphPad = 28;

function graphEdges(projects: ProjectCounts[]): GraphEdge[] {
	const names = new Set(projects.map((project) => project.name));
	return projects.flatMap((project) =>
		project.crossProjectBlockers
			.filter((blocker) => names.has(blocker.project))
			.map((blocker) => ({
				from: project.name,
				blocker,
			})),
	);
}

function graphLayout(projects: ProjectCounts[], edges: GraphEdge[]) {
	const depth = new Map(projects.map((project) => [project.name, 0]));
	for (let pass = 0; pass < projects.length; pass += 1) {
		for (const edge of edges) {
			const next = (depth.get(edge.from) ?? 0) + 1;
			if (next > (depth.get(edge.blocker.project) ?? 0)) {
				depth.set(edge.blocker.project, next);
			}
		}
	}
	const columns = new Map<number, string[]>();
	for (const project of projects) {
		const column = depth.get(project.name) ?? 0;
		const names = columns.get(column) ?? [];
		names.push(project.name);
		columns.set(column, names);
	}
	const place = new Map<string, { x: number; y: number }>();
	for (const [column, names] of columns) {
		names.forEach((name, row) => {
			place.set(name, {
				x: graphPad + column * graphColumnGap,
				y: graphPad + row * graphRowStep,
			});
		});
	}
	const widest = Math.max(1, columns.size);
	const width = graphPad * 2 + (widest - 1) * graphColumnGap + graphNodeWidth;
	const tallest = Math.max(
		1,
		...[...columns.values()].map((names) => names.length),
	);
	const height = graphPad + tallest * graphRowStep;
	return { place, width, height };
}

function GraphNode({ project }: { project: ProjectCounts }) {
	return (
		<button
			type="button"
			className={clsx(
				cards.node,
				cards.pointer,
				project.needsYou > 0 && cards.nodeNeed,
			)}
			onClick={() => openProject(project.name)}
		>
			<span className={clsx(cards.nodeTop)}>
				<strong>{project.name}</strong>
				{project.needsYou === 0 ? null : (
					<span className={clsx(cards.badge)}>{project.needsYou}</span>
				)}
			</span>
			<span className={clsx(cards.meta)}>{trackerName(project.tracker)}</span>
			<SegmentedBar project={project} />
			<span className={clsx(cards.quiet)}>
				{project.done} of {ticketTotal(project)} done
			</span>
		</button>
	);
}

function GraphView({ projects }: { projects: ProjectCounts[] }) {
	const edges = graphEdges(projects);
	const { place, width, height } = graphLayout(projects, edges);
	const byName = new Map(projects.map((project) => [project.name, project]));
	return (
		<div className={clsx(cards.graph)}>
			<div className={clsx(cards.canvas)} style={{ height }}>
				<svg
					className={clsx(cards.arrows)}
					width={width}
					height={height}
					aria-hidden="true"
				>
					{edges.map((edge) => {
						const from = place.get(edge.from);
						const to = place.get(edge.blocker.project);
						if (from === undefined || to === undefined) {
							return null;
						}
						const x1 = from.x + graphNodeWidth;
						const y1 = from.y + graphNodeHeight / 2;
						const x2 = to.x;
						const y2 = to.y + graphNodeHeight / 2;
						const mid = (x1 + x2) / 2;
						return (
							<g
								key={`${edge.from}-${edge.blocker.project}-${edge.blocker.key}`}
							>
								<path
									d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
									className={clsx(cards.arrow)}
								/>
								<a
									href={projectPath(edge.blocker.project, edge.blocker.key)}
									onClick={(event) => {
										event.preventDefault();
										openProject(edge.blocker.project, edge.blocker.key);
									}}
								>
									<text
										x={mid}
										y={(y1 + y2) / 2 - 8}
										className={clsx(cards.edgeLabel)}
									>
										{edge.blocker.key}
									</text>
								</a>
							</g>
						);
					})}
				</svg>
				{projects.map((project) => {
					const spot = place.get(project.name);
					if (spot === undefined || byName.get(project.name) === undefined) {
						return null;
					}
					return (
						<div
							key={`${project.tracker}:${project.name}`}
							className={clsx(cards.placed)}
							{...stylex.props(cards.placeAt(`${spot.x}px`, `${spot.y}px`))}
						>
							<GraphNode project={project} />
						</div>
					);
				})}
			</div>
		</div>
	);
}

function MiniBar({ project }: { project: ProjectCounts }) {
	return (
		<span className={clsx(cards.mini)}>
			<SegmentedBar project={project} />
			<span>{project.progress}%</span>
		</span>
	);
}

function TableView({ projects }: { projects: ProjectCounts[] }) {
	return (
		<div className={clsx(cards.tableWrap)}>
			<table className={clsx(cards.table)}>
				<thead>
					<tr>
						<th className={clsx(cards.cell, cards.headCell)} />
						<th className={clsx(cards.cell, cards.headCell)}>Project</th>
						<th className={clsx(cards.cell, cards.headCell)}>Tracker</th>
						<th className={clsx(cards.cell, cards.headCell)}>
							{overviewSortLabel.progress}
						</th>
						<th className={clsx(cards.cell, cards.headCell)}>
							{stateLabel.backlog}
						</th>
						<th className={clsx(cards.cell, cards.headCell)}>
							{stateLabel.inProgress}
						</th>
						<th className={clsx(cards.cell, cards.headCell)}>
							{stateLabel.inReview}
						</th>
						<th className={clsx(cards.cell, cards.headCell)}>
							{stateLabel.awaitingMerge}
						</th>
						<th className={clsx(cards.cell, cards.headCell)}>Needs you</th>
						<th className={clsx(cards.cell, cards.headCell)}>Blocked by</th>
					</tr>
				</thead>
				<tbody>
					{projects.map((project) => (
						<tr key={`${project.tracker}:${project.name}`}>
							<td className={clsx(cards.cell)}>
								<PinMark on={project.pinned} />
							</td>
							<td className={clsx(cards.cell)}>
								<a
									className={clsx(cards.projectLink)}
									href={projectPath(project.name)}
									onClick={(event) => {
										event.preventDefault();
										openProject(project.name);
									}}
								>
									{project.name}
								</a>
							</td>
							<td className={clsx(cards.cell, cards.quiet)}>
								{trackerName(project.tracker)}
							</td>
							<td className={clsx(cards.cell)}>
								<MiniBar project={project} />
							</td>
							<td className={clsx(cards.cell)}>
								{project.statusTypes.backlog}
							</td>
							<td className={clsx(cards.cell)}>
								{project.statusTypes.inProgress}
							</td>
							<td className={clsx(cards.cell)}>
								{project.statusTypes.inReview}
							</td>
							<td className={clsx(cards.cell)}>
								{project.statusTypes.awaitingMerge}
							</td>
							<td className={clsx(cards.cell)}>
								{project.needsYou === 0 ? (
									<span className={clsx(cards.quiet)}>0</span>
								) : (
									<span className={clsx(cards.badge)}>{project.needsYou}</span>
								)}
							</td>
							<td className={clsx(cards.cell)}>
								{project.crossProjectBlockers.map((blocker) => (
									<Chip
										key={`${blocker.project} ${blocker.key}`}
										blocker={blocker}
									/>
								))}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function RefreshIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(frame.glyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M20 12a8 8 0 1 1-2.3-5.6" />
			<path d="M20 4v5h-5" />
		</svg>
	);
}

function MenuButton({
	id,
	label,
	open,
	onToggle,
	children,
}: {
	id: string;
	label: ReactNode;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<div className={clsx(cards.menu)}>
			<button
				type="button"
				id={id}
				className={clsx(cards.control, shell.buttonFocus)}
				aria-expanded={open}
				aria-controls={`${id}-panel`}
				onClick={onToggle}
			>
				{label}
			</button>
			{open ? (
				<div id={`${id}-panel`} className={clsx(cards.panel)}>
					{children}
				</div>
			) : null}
		</div>
	);
}

function ticketKey(key: string): string {
	const hash = key.lastIndexOf("#");
	return hash === -1 ? key : key.slice(hash + 1);
}

async function readSettings(): Promise<Configuration | null> {
	const response = await fetch("/api/settings");
	if (!response.ok) {
		return null;
	}
	const body: unknown = await response.json();
	if (body === null || typeof body !== "object") {
		return null;
	}
	return body as Configuration;
}

async function writeSettings(next: Configuration): Promise<boolean> {
	const response = await fetch("/api/settings", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(next),
	});
	return response.ok;
}

function OverviewPage({
	overview,
	settings,
	onSettings,
}: {
	overview: Overview;
	settings: Configuration;
	onSettings: (next: Configuration) => void;
}) {
	const [query, setQuery] = useState("");
	const [menu, setMenu] = useState<"pinned" | "filter" | "sort" | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const [notifyPermission, setNotifyPermission] = useState(
		notificationPermission,
	);
	const view = settings.overview;
	const projects = useMemo(
		() => shownProjects(overview, view, query),
		[overview, view, query],
	);
	const polled = polledLine(overview.fetchedAt, now);
	const [needs, setNeeds] = useState<NeedsYouItem[]>([]);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		let stopped = false;
		const load = () => {
			void fetch("/api/needs-you")
				.then(async (response) => {
					if (!stopped && response.ok) {
						setNeeds((await response.json()) as NeedsYouItem[]);
					}
				})
				.catch(() => {
					if (!stopped) {
						setNeeds([]);
					}
				});
		};
		load();
		const stop = onAppEvent("overview", load);
		return () => {
			stopped = true;
			stop();
		};
	}, []);
	const savePatch = (patch: (current: Configuration) => Configuration) => {
		onSettings(patch(settings));
		void readSettings().then(async (current) => {
			if (current === null) {
				return;
			}
			const next = patch(current);
			onSettings(next);
			if (await writeSettings(next)) {
				return;
			}
			const saved = await readSettings();
			if (saved !== null) {
				onSettings(saved);
			}
		});
	};
	const saveView = (next: OverviewView) => {
		savePatch((current) => ({ ...current, overview: next }));
		setMenu(null);
	};
	const togglePin = (project: ProjectCounts) => {
		savePatch((current) => {
			const pinned = current.pinned.some((item) => sameRef(item, project.ref))
				? current.pinned.filter((item) => !sameRef(item, project.ref))
				: [...current.pinned, project.ref];
			return { ...current, pinned };
		});
	};
	const panes = {
		cards: <CardsList projects={projects} />,
		graph: <GraphView projects={projects} />,
		table: <TableView projects={projects} />,
	};
	const views: PageView[] = overviewViews.map((name) => ({
		id: name,
		label: viewLabel[name],
	}));
	const tickets = overview.projects.reduce(
		(sum, project) => sum + ticketTotal(project),
		0,
	);
	const pinnedCount = overview.projects.filter(
		(project) => project.pinned,
	).length;
	const summary = [
		`${overview.projects.length} projects`,
		`${tickets} tickets`,
		polled,
	]
		.filter((part) => part !== null)
		.join(", ");
	const sectionTitle =
		view.view === "graph" ? "Projects and their blockers" : navLabel.projects;
	return (
		<PageFrame
			title={navLabel.overview}
			subtitle={summary}
			search={
				<label className={clsx(frame.searchBox)} htmlFor="overview-search">
					<SearchGlyph />
					<input
						id="overview-search"
						className={clsx(frame.search)}
						type="search"
						aria-label={overviewControlLabel.search}
						placeholder={overviewControlLabel.search}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
			}
			views={views}
			view={view.view}
			onView={(id) => {
				const next = overviewViews.find((name) => name === id);
				if (next !== undefined) {
					saveView({ ...view, view: next });
				}
			}}
		>
			{needs.length === 0 || view.view !== "cards" ? null : (
				<section>
					<div className={clsx(cards.section)}>
						<h2 className={clsx(cards.sectionLabel)}>{navLabel.needsYou}</h2>
						<a className={clsx(cards.viewAll)} href="/needs-you">
							View all
						</a>
					</div>
					<ul className={clsx(cards.needs)}>
						{needs.slice(0, 4).map((item) => (
							<li
								key={`${item.project}:${item.key}`}
								className={clsx(cards.need)}
							>
								<a
									className={clsx(cards.needKey)}
									href={projectPath(item.project, item.key)}
								>
									{item.project}#{ticketKey(item.key)}
								</a>
								<a
									className={clsx(cards.needTitle)}
									href={projectPath(item.project, item.key)}
								>
									{item.headline}
								</a>
								<a
									className={clsx(cards.pill)}
									href={projectPath(item.project, item.key)}
								>
									{actionLabel(item, "strip")}
								</a>
							</li>
						))}
					</ul>
				</section>
			)}
			<div className={clsx(cards.section)}>
				<h2 className={clsx(cards.sectionLabel)}>{sectionTitle}</h2>
				<div className={clsx(cards.controls)}>
					<MenuButton
						id="overview-pinned"
						label={
							<>
								<PinMark on /> {overviewControlLabel.pinned} {pinnedCount}
							</>
						}
						open={menu === "pinned"}
						onToggle={() => setMenu(menu === "pinned" ? null : "pinned")}
					>
						{overview.projects.map((project) => (
							<label
								key={`${project.tracker}:${project.name}`}
								className={clsx(cards.choice)}
							>
								<input
									type="checkbox"
									checked={project.pinned}
									onChange={() => togglePin(project)}
								/>
								{project.name}
							</label>
						))}
					</MenuButton>
					<MenuButton
						id="overview-filter"
						label={overviewControlLabel.filter}
						open={menu === "filter"}
						onToggle={() => setMenu(menu === "filter" ? null : "filter")}
					>
						{overviewFilters.map((item) => (
							<label key={item} className={clsx(cards.choice)}>
								<input
									type="radio"
									name="overview-filter"
									value={item}
									checked={view.filter === item}
									onChange={() => saveView({ ...view, filter: item })}
								/>
								{overviewFilterLabel[item]}
							</label>
						))}
					</MenuButton>
					{view.view === "table" ? null : (
						<MenuButton
							id="overview-sort"
							label={
								view.sort === "needs-you"
									? overviewControlLabel.needsYouFirst
									: overviewSortLabel[view.sort]
							}
							open={menu === "sort"}
							onToggle={() => setMenu(menu === "sort" ? null : "sort")}
						>
							{overviewSorts.map((item) => (
								<label key={item} className={clsx(cards.choice)}>
									<input
										type="radio"
										name="overview-sort"
										value={item}
										checked={view.sort === item}
										onChange={() => saveView({ ...view, sort: item })}
									/>
									{overviewSortLabel[item]}
								</label>
							))}
						</MenuButton>
					)}
				</div>
			</div>
			<button
				type="button"
				id="overview-refresh"
				className={clsx(frame.icon, shell.buttonFocus)}
				aria-label="Refresh"
				title="Refresh"
				onClick={() => {
					void fetch("/api/refresh", { method: "POST" });
				}}
			>
				<RefreshIcon />
			</button>
			{notifyPermission === "default" && typeof Notification !== "undefined" ? (
				<button
					type="button"
					id="notify-permission"
					className={clsx(frame.legend)}
					onClick={() => {
						void askNotificationPermission().finally(() => {
							setNotifyPermission(notificationPermission());
						});
					}}
				>
					Allow notifications
				</button>
			) : null}
			{overview.polling === true ? (
				<p className={clsx(cards.loading)}>Loading projects</p>
			) : overview.error !== null ? (
				<p className={clsx(shell.stale)}>{overview.error}</p>
			) : null}
			{panes[view.view]}
			{view.view === "graph" ? (
				<p className={clsx(cards.caption)}>
					An arrow runs from a blocking project to the project it blocks. Its
					label is the blocking ticket; click it to open that ticket. Projects
					with a dark border need you.
				</p>
			) : null}
		</PageFrame>
	);
}

async function readOverview(): Promise<Overview> {
	const response = await fetch("/api/overview");
	if (!response.ok) {
		throw new Error(`overview failed (HTTP ${response.status})`);
	}
	return (await response.json()) as Overview;
}

function Page() {
	const [overview, setOverview] = useState<Overview | null>(null);
	const [settings, setSettings] = useState<Configuration | null>(null);
	useEffect(() => {
		const show = (next: Overview) => {
			setOverview(next);
		};
		const stopOverview = onAppEvent("overview", (event) => {
			show(JSON.parse(event.data) as Overview);
		});
		const stopOpen = onEventStreamOpen(() => {
			void readOverview().then(show);
		});
		void readOverview().then(show);
		void readSettings().then((loaded) => {
			if (loaded !== null) {
				setSettings(loaded);
			}
		});
		return () => {
			stopOverview();
			stopOpen();
		};
	}, []);
	if (overview === null || settings === null) {
		return <PageFrame title={navLabel.overview}>Loading projects</PageFrame>;
	}
	return (
		<OverviewPage
			overview={overview}
			settings={settings}
			onSettings={setSettings}
		/>
	);
}

if (typeof document !== "undefined") {
	const root = document.getElementById("root");
	if (root !== null) {
		createRoot(root).render(<Page />);
	}
}
