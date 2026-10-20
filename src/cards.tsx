import * as stylex from "@stylexjs/stylex";
import mermaid from "mermaid";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
import { mermaidTheme, watchPageTheme } from "./theme.ts";
import { classToken, clsx } from "./ui.ts";
import { cards, frame, shell } from "./ui-styles.ts";

function startMermaid(): void {
	mermaid.initialize({ startOnLoad: false, theme: mermaidTheme() });
}

startMermaid();

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
			{blocker.project}#{blocker.key}
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

function nodeId(name: string): string {
	return `node-${slug(name)}`;
}

function edgeId(from: string, blocker: CrossProjectBlocker): string {
	return `edge-${slug(from)}-${slug(blocker.key)}`;
}

function graphEdges(projects: ProjectCounts[]): GraphEdge[] {
	return projects.flatMap((project) =>
		project.crossProjectBlockers.map((blocker) => ({
			from: project.name,
			blocker,
		})),
	);
}

function mermaidText(value: string): string {
	return value.replaceAll('"', "#quot;");
}

function mermaidSource(projects: ProjectCounts[], edges: GraphEdge[]): string {
	const lines = ["flowchart LR"];
	for (const project of projects) {
		lines.push(`  ${nodeId(project.name)}["${mermaidText(project.name)}"]`);
	}
	for (const edge of edges) {
		lines.push(
			`  ${nodeId(edge.from)} ${edgeId(edge.from, edge.blocker)}@-->|"${mermaidText(edge.blocker.key)}"| ${nodeId(edge.blocker.project)}`,
		);
	}
	return lines.join("\n");
}

function renderGraph(projects: ProjectCounts[]): Promise<string> {
	return mermaid
		.render("project-flow-graph", mermaidSource(projects, graphEdges(projects)))
		.then((result) => result.svg)
		.catch(() => "");
}

function htmlSpan(root: ParentNode, selector: string): HTMLElement | null {
	const span = root.querySelector(selector);
	return span instanceof HTMLElement ? span : null;
}

function nodeLabel(host: ParentNode, id: string): HTMLElement | null {
	const pattern = new RegExp(`-${id}-\\d+$`);
	const shape = [...host.querySelectorAll(".node")].find((item) =>
		pattern.test(item.id),
	);
	const span = shape?.querySelector("span.nodeLabel");
	return span instanceof HTMLElement ? span : null;
}

function bindGraph(
	host: HTMLElement,
	projects: ProjectCounts[],
	edges: GraphEdge[],
): void {
	for (const project of projects) {
		const id = nodeId(project.name);
		const label = nodeLabel(host, id);
		if (label === null) {
			continue;
		}
		label.id = id;
		label.closest(".node")?.classList.add(classToken(cards.pointer));
		label.classList.add(classToken(cards.pointer));
		label.addEventListener("click", () => openProject(project.name));
	}
	for (const edge of edges) {
		const id = edgeId(edge.from, edge.blocker);
		const label = htmlSpan(host, `[data-id="${id}"] span.edgeLabel`);
		if (label === null) {
			continue;
		}
		label.id = id;
		label.classList.add(classToken(cards.pointer));
		label.addEventListener("click", () =>
			openProject(edge.blocker.project, edge.blocker.key),
		);
	}
}

function GraphView({
	projects,
	svg,
}: {
	projects: ProjectCounts[];
	svg: string | null;
}) {
	const host = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const node = host.current;
		if (node === null || svg === null || svg === "") {
			return;
		}
		node.insertAdjacentHTML("beforeend", svg);
		bindGraph(node, projects, graphEdges(projects));
	}, [projects, svg]);
	return (
		<div className={clsx(cards.graph)}>
			<div ref={host} className={clsx(cards.mermaidHost)} />
			{svg === null || svg === "" ? (
				<ul className={clsx(cards.nodes)}>
					{projects.map((project) => (
						<li key={`${project.tracker}:${project.name}`}>
							<button
								type="button"
								className={clsx(cards.node, cards.pointer)}
								onClick={() => openProject(project.name)}
							>
								<strong>{project.name}</strong>
								<span className={clsx(cards.meta)}>
									{trackerName(project.tracker)}
								</span>
								<span>
									{project.done} of {ticketTotal(project)} done
								</span>
								<SegmentedBar project={project} />
							</button>
						</li>
					))}
				</ul>
			) : null}
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

function actionLabel(item: NeedsYouItem): string {
	const key = ticketKey(item.key);
	if (item.reason === "awaitingMerge") {
		return `Merge PR #${key}`;
	}
	if (item.reason === "ask") {
		return "Answer question";
	}
	if (item.reason === "runFailed") {
		return "Open run";
	}
	return `Review ${key}`;
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
	const [graphSvg, setGraphSvg] = useState<string | null>(null);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		if (view.view !== "graph") {
			return;
		}
		let stopped = false;
		startMermaid();
		void renderGraph(projects).then((svg) => {
			if (!stopped && svg !== "") {
				setGraphSvg(svg);
			}
		});
		return () => {
			stopped = true;
		};
	}, [projects, view.view]);
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
		graph: <GraphView projects={projects} svg={graphSvg} />,
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
									{actionLabel(item)}
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
									? "Needs you first"
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
			{notifyPermission === "default" ? (
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
					label is the blocking ticket. Projects with a dark border need you.
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
		const stopTheme = watchPageTheme(startMermaid);
		void readOverview().then(show);
		void readSettings().then((loaded) => {
			if (loaded !== null) {
				setSettings(loaded);
			}
		});
		return () => {
			stopOverview();
			stopOpen();
			stopTheme();
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
