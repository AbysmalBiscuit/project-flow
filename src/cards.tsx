import mermaid from "mermaid";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { Configuration, OverviewView } from "./configuration.ts";
import type { CrossProjectBlocker, Overview, ProjectCounts } from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import {
	askNotificationPermission,
	notificationPermission,
} from "./notify.tsx";
import { PageFrame, type PageView } from "./shell.tsx";
import {
	blockedLabel,
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
			{blocker.project} {blocker.key}
		</a>
	);
}

const tabs = ["cards", "graph", "table"] as const;
type FilterKey = OverviewView["filter"];
type SortKey = OverviewView["sort"];

const filters = ["all", "needs-you", "blocked", "pinned"] as const;
const sorts = ["name", "progress", "needs-you", "blockers"] as const;

const defaultView: OverviewView = {
	filter: "all",
	sort: "name",
	view: "cards",
};

function isOverviewView(value: unknown): value is OverviewView {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const view = value as Partial<OverviewView>;
	return (
		filters.some((item) => item === view.filter) &&
		sorts.some((item) => item === view.sort) &&
		tabs.some((item) => item === view.view)
	);
}

function pinLine(ref: Configuration["pinned"][number]): string {
	if (ref.tracker === "linear") {
		return ref.project;
	}
	if ("repo" in ref) {
		return ref.repo;
	}
	return `${ref.owner}/${ref.project}`;
}

function samePin(
	project: ProjectCounts,
	ref: Configuration["pinned"][number],
): boolean {
	if (ref.tracker !== project.tracker) {
		return false;
	}
	return pinLine(ref).toLowerCase() === project.name.toLowerCase();
}

function isPinned(
	project: ProjectCounts,
	pinned: Configuration["pinned"],
): boolean {
	return pinned.some((ref) => samePin(project, ref));
}

function matchesFilter(
	project: ProjectCounts,
	filter: FilterKey,
	pinned: Configuration["pinned"],
): boolean {
	if (filter === "needs-you") {
		return project.needsYou > 0;
	}
	if (filter === "blocked") {
		return project.blocked > 0 || project.crossProjectBlockers.length > 0;
	}
	if (filter === "pinned") {
		return isPinned(project, pinned);
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
	pinned: Configuration["pinned"],
	query: string,
): ProjectCounts[] {
	return sortProjects(
		overview.projects.filter(
			(project) =>
				matchesFilter(project, view.filter, pinned) &&
				matchesSearch(project, query),
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
	const age = Math.floor((now - at) / 1000);
	if (age < 0) {
		return `${overviewControlLabel.polled} ${fetchedAt}`;
	}
	return `${overviewControlLabel.polled} ${age} s ago`;
}

function slug(value: string): string {
	const cleaned = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return cleaned === "" ? "item" : cleaned;
}

function ProjectLink({
	name,
	className,
	children,
}: {
	name: string;
	className: string;
	children: string;
}) {
	return (
		<a
			className={className}
			href={projectPath(name)}
			onClick={(event) => {
				event.preventDefault();
				openProject(name);
			}}
		>
			{children}
		</a>
	);
}

const statusCounts = [
	{ key: "done", label: stateLabel.done, swatch: cards.done },
	{ key: "dropped", label: stateLabel.dropped, swatch: cards.dropped },
	{ key: "backlog", label: stateLabel.backlog, swatch: cards.backlog },
	{ key: "inProgress", label: stateLabel.inProgress, swatch: cards.inProgress },
	{ key: "inReview", label: stateLabel.inReview, swatch: cards.inReview },
	{
		key: "awaitingMerge",
		label: stateLabel.awaitingMerge,
		swatch: cards.awaitingMerge,
	},
] as const;

function ProjectCard({ project }: { project: ProjectCounts }) {
	const id = `project-card-${slug(project.name)}`;
	return (
		<li id={id} className={clsx(cards.card)}>
			<a
				className={clsx(cards.projectLink)}
				href={projectPath(project.name)}
				aria-label={project.name}
				onClick={(event) => {
					event.preventDefault();
					openProject(project.name);
				}}
			>
				<h2 className={clsx(shell.heading)}>
					{project.name}
					{project.needsYou === 0 ? null : (
						<span className={clsx(cards.badge)}>{project.needsYou}</span>
					)}
				</h2>
				<div
					className={clsx(cards.bar)}
					role="progressbar"
					aria-valuenow={project.progress}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-label={`${project.name} progress`}
				>
					<div
						className={clsx(cards.fill)}
						style={{ width: `${project.progress}%` }}
					/>
				</div>
			</a>
			{project.error === null ? null : (
				<p className={clsx(shell.stale)}>{project.error}</p>
			)}
			<p className={clsx(cards.counts)}>
				{statusCounts.map((item) => (
					<span key={item.key} className={clsx(cards.count)}>
						<span className={clsx(cards.swatch, item.swatch)} />
						{item.label} {project.statusTypes[item.key]}
					</span>
				))}
				<span className={clsx(cards.count)}>
					<span className={clsx(cards.swatch, cards.blocked)} />
					{blockedLabel} {project.blocked}
				</span>
			</p>
			{project.tags.length === 0 ? null : (
				<p className={clsx(cards.tags)}>{project.tags.join(" ")}</p>
			)}
			{project.crossProjectBlockers.length === 0 ? null : (
				<p className={clsx(cards.blockers)}>
					{project.crossProjectBlockers.map((blocker) => (
						<Chip key={`${blocker.project} ${blocker.key}`} blocker={blocker} />
					))}
				</p>
			)}
			{project.unlinkedPrs.length === 0 ? null : (
				<p className={clsx(cards.unlinked)}>
					{overviewControlLabel.unlinked}{" "}
					{project.unlinkedPrs.map((pull) => pull.title).join(", ")}
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

function graphEdges(overview: Overview): GraphEdge[] {
	return overview.projects.flatMap((project) =>
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

async function renderGraph(overview: Overview): Promise<string> {
	try {
		const drawn = await mermaid.render(
			"project-flow-graph",
			mermaidSource(overview.projects, graphEdges(overview)),
		);
		return drawn.svg;
	} catch {
		return "";
	}
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
	overview: Overview,
	edges: GraphEdge[],
): void {
	for (const project of overview.projects) {
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
	overview,
	projects,
	svg,
}: {
	overview: Overview;
	projects: ProjectCounts[];
	svg: string;
}) {
	const host = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const node = host.current;
		if (node === null) {
			return;
		}
		node.replaceChildren();
		if (svg === "") {
			return;
		}
		const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
		const drawn = parsed.documentElement;
		if (drawn.namespaceURI !== "http://www.w3.org/2000/svg") {
			return;
		}
		node.appendChild(document.importNode(drawn, true));
		bindGraph(
			node,
			{ ...overview, projects },
			graphEdges({ ...overview, projects }),
		);
	}, [overview, projects, svg]);
	return (
		<div className={clsx(cards.graph)}>
			<div ref={host} className={clsx(cards.mermaidHost)} />
		</div>
	);
}

function TableView({ projects }: { projects: ProjectCounts[] }) {
	return (
		<table className={clsx(cards.table)}>
			<thead>
				<tr>
					<th className={clsx(cards.cell, cards.head)}>Project</th>
					<th className={clsx(cards.cell, cards.head)}>
						{overviewSortLabel.progress}
					</th>
					<th className={clsx(cards.cell, cards.head)}>
						{overviewSortLabel["needs-you"]}
					</th>
					<th className={clsx(cards.cell, cards.head)}>
						{overviewSortLabel.blockers}
					</th>
				</tr>
			</thead>
			<tbody>
				{projects.map((project) => (
					<tr key={`${project.tracker}:${project.name}`}>
						<td className={clsx(cards.cell)}>
							<ProjectLink
								name={project.name}
								className={clsx(cards.projectLink)}
							>
								{project.name}
							</ProjectLink>
						</td>
						<td className={clsx(cards.cell)}>{project.progress}%</td>
						<td className={clsx(cards.cell)}>{project.needsYou}</td>
						<td className={clsx(cards.cell)}>
							{project.crossProjectBlockers.length}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function CheckMenu({
	id,
	label,
	open,
	onToggle,
	children,
}: {
	id: string;
	label: string;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<div className={clsx(cards.menu)}>
			<button
				type="button"
				id={id}
				className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
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
	graphSvg,
	onSettings,
}: {
	overview: Overview;
	settings: Configuration;
	graphSvg: string;
	onSettings: (next: Configuration) => void;
}) {
	const [query, setQuery] = useState("");
	const [menu, setMenu] = useState<"pinned" | "filter" | "sort" | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const [notifyPermission, setNotifyPermission] = useState(
		notificationPermission,
	);
	const view = isOverviewView(settings.overview)
		? settings.overview
		: defaultView;
	const projects = shownProjects(overview, view, settings.pinned, query);
	const polled = polledLine(overview.fetchedAt, now);
	const needs = overview.projects.flatMap((project) =>
		project.needsYou === 0
			? []
			: project.tickets
					.filter((ticket) => ticket.key !== null)
					.slice(0, 1)
					.map((ticket) => ({
						project: project.name,
						key: ticket.key ?? "",
						title: ticket.title,
					})),
	);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const savePatch = (patch: (current: Configuration) => Configuration) => {
		onSettings(patch(settings));
		void readSettings().then((current) => {
			if (current === null) {
				return;
			}
			const next = patch(current);
			onSettings(next);
			void writeSettings(next);
		});
	};
	const saveView = (next: OverviewView) => {
		savePatch((current) => ({ ...current, overview: next }));
		setMenu(null);
	};
	const togglePin = (project: ProjectCounts) => {
		savePatch((current) => {
			const pinned = isPinned(project, current.pinned)
				? current.pinned.filter((ref) => !samePin(project, ref))
				: [
						...current.pinned,
						project.tracker === "linear"
							? { tracker: "linear" as const, project: project.name }
							: project.name.includes("/")
								? { tracker: "github" as const, repo: project.name }
								: null,
					].filter((ref) => ref !== null);
			return { ...current, pinned };
		});
	};
	const panes = {
		cards: <CardsList projects={projects} />,
		graph: <GraphView overview={overview} projects={projects} svg={graphSvg} />,
		table: <TableView projects={projects} />,
	};
	const views: PageView[] = tabs.map((name) => ({
		id: name,
		label: viewLabel[name],
	}));
	return (
		<PageFrame
			title={navLabel.overview}
			filter={
				<CheckMenu
					id="overview-filter"
					label={overviewControlLabel.filter}
					open={menu === "filter"}
					onToggle={() => setMenu(menu === "filter" ? null : "filter")}
				>
					{filters.map((item) => (
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
				</CheckMenu>
			}
			sort={
				<CheckMenu
					id="overview-sort"
					label={overviewControlLabel.sort}
					open={menu === "sort"}
					onToggle={() => setMenu(menu === "sort" ? null : "sort")}
				>
					{sorts.map((item) => (
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
				</CheckMenu>
			}
			search={
				<input
					id="overview-search"
					className={clsx(frame.search)}
					type="search"
					aria-label={overviewControlLabel.search}
					placeholder={overviewControlLabel.search}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			}
			views={views}
			view={view.view}
			onView={(id) => {
				const next = tabs.find((name) => name === id);
				if (next !== undefined) {
					saveView({ ...view, view: next });
				}
			}}
		>
			<CheckMenu
				id="overview-pinned"
				label={overviewControlLabel.pinned}
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
							checked={isPinned(project, settings.pinned)}
							onChange={() => togglePin(project)}
						/>
						{project.name}
					</label>
				))}
			</CheckMenu>
			{needs.length === 0 ? null : (
				<p className={clsx(cards.strip)}>
					{navLabel.needsYou}
					{needs.slice(0, 3).map((item) => (
						<a
							key={`${item.project}:${item.key}`}
							className={clsx(cards.stripLink)}
							href={projectPath(item.project, item.key)}
						>
							{item.key} {item.title}
						</a>
					))}
				</p>
			)}
			{polled === null ? null : <p className={clsx(cards.fresh)}>{polled}</p>}
			{notifyPermission === "default" ? (
				<button
					type="button"
					id="notify-permission"
					className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
					onClick={() => {
						void askNotificationPermission().finally(() => {
							setNotifyPermission(notificationPermission());
						});
					}}
				>
					Allow notifications
				</button>
			) : null}
			<button
				type="button"
				className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
				onClick={() => {
					void fetch("/api/refresh", { method: "POST" });
				}}
			>
				Refresh
			</button>
			{overview.polling === true ? (
				<p className={clsx(cards.loading)}>Loading projects</p>
			) : overview.error !== null ? (
				<p className={clsx(shell.stale)}>{overview.error}</p>
			) : null}
			{panes[view.view]}
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
	const [graphSvg, setGraphSvg] = useState("");
	useEffect(() => {
		const show = (next: Overview) => {
			setOverview(next);
			startMermaid();
			void renderGraph(next).then(setGraphSvg);
		};
		const stopOverview = onAppEvent("overview", (event) => {
			show(JSON.parse(event.data) as Overview);
		});
		const stopOpen = onEventStreamOpen(() => {
			void readOverview().then(show);
		});
		const stopTheme = watchPageTheme(() => {
			startMermaid();
			setOverview((current) => {
				if (current !== null) {
					void renderGraph(current).then(setGraphSvg);
				}
				return current;
			});
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
			graphSvg={graphSvg}
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
