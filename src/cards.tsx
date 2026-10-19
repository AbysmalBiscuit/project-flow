import mermaid from "mermaid";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CrossProjectBlocker, Overview, ProjectCounts } from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import {
	askNotificationPermission,
	notificationPermission,
} from "./notify.tsx";
import { navLabel, stateLabel, viewLabel } from "./terms.ts";
import { mermaidTheme, watchPageTheme } from "./theme.ts";
import { classToken, clsx } from "./ui.ts";
import { cards, shell } from "./ui-styles.ts";

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

const tabKey = "project-flow-overview-tab";
const tabs = ["cards", "graph", "table"] as const;
type Tab = (typeof tabs)[number];
type SortKey = "progress" | "needsYou" | "blockers";

function readTab(): Tab {
	try {
		const stored = localStorage.getItem(tabKey);
		return tabs.find((tab) => tab === stored) ?? "cards";
	} catch {
		return "cards";
	}
}

function writeTab(next: Tab): void {
	try {
		localStorage.setItem(tabKey, next);
	} catch {
		// A private window can throw. The chosen tab still shows this visit.
	}
}

const sortKeys = [
	{ key: "progress", id: "sort-progress", label: "Progress" },
	{ key: "needsYou", id: "sort-needs-you", label: navLabel.needsYou },
	{ key: "blockers", id: "sort-blockers", label: "Cross-project blockers" },
] as const;

function sortValue(project: ProjectCounts, key: SortKey): number {
	if (key === "progress") {
		return project.progress;
	}
	if (key === "needsYou") {
		return project.needsYou;
	}
	return project.crossProjectBlockers.length;
}

function sortProjects(
	projects: ProjectCounts[],
	key: SortKey,
): ProjectCounts[] {
	const leastFirst = key === "progress";
	return [...projects].sort((left, right) => {
		const delta = sortValue(left, key) - sortValue(right, key);
		if (delta !== 0) {
			return leastFirst ? delta : -delta;
		}
		return left.name.localeCompare(right.name);
	});
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

function CardsList({ overview }: { overview: Overview }) {
	return (
		<ul className={clsx(cards.list)}>
			{overview.projects.map((project) => (
				<li
					key={`${project.tracker}:${project.name}`}
					className={clsx(cards.card)}
				>
					<h2 className={clsx(shell.heading)}>
						<ProjectLink
							name={project.name}
							className={clsx(cards.projectLink)}
						>
							{project.name}
						</ProjectLink>
					</h2>
					{project.error === null ? null : (
						<p className={clsx(shell.stale)}>{project.error}</p>
					)}
					<p className={clsx(cards.counts)}>
						<span className={clsx(cards.count)}>
							<span className={clsx(cards.swatch, cards.done)} />
							{stateLabel.done} {project.done}
						</span>
						<span className={clsx(cards.count)}>
							<span className={clsx(cards.swatch, cards.dropped)} />
							{stateLabel.dropped} {project.dropped}
						</span>
						<span className={clsx(cards.count)}>
							<span className={clsx(cards.swatch, cards.blocked)} />
							{stateLabel.blocked} {project.blocked}
						</span>
						<span className={clsx(cards.count)}>
							<span className={clsx(cards.swatch, cards.backlog)} />
							{stateLabel.backlog} {project.backlog}
						</span>
						<span className={clsx(cards.count)}>
							<span className={clsx(cards.swatch, cards.inProgress)} />
							{stateLabel.inProgress} {project.inProgress}
						</span>
						<span className={clsx(cards.count)}>
							<span className={clsx(cards.swatch, cards.inReview)} />
							{stateLabel.inReview} {project.inReview}
						</span>
						<span className={clsx(cards.count)}>
							<span className={clsx(cards.swatch, cards.awaitingMerge)} />
							{stateLabel.awaitingMerge} {project.awaitingMerge}
						</span>
						<span className={clsx(cards.count)}>
							{navLabel.needsYou} {project.needsYou}
						</span>
					</p>
					{project.tags.length === 0 ? null : (
						<p className={clsx(cards.tags)}>{project.tags.join(" ")}</p>
					)}
					{project.crossProjectBlockers.length === 0 ? null : (
						<p className={clsx(cards.blockers)}>
							{project.crossProjectBlockers.map((blocker) => (
								<Chip
									key={`${blocker.project} ${blocker.key}`}
									blocker={blocker}
								/>
							))}
						</p>
					)}
				</li>
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

function GraphView({ overview, svg }: { overview: Overview; svg: string }) {
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
		bindGraph(node, overview, graphEdges(overview));
	}, [overview, svg]);
	return (
		<div className={clsx(cards.graph)}>
			<div ref={host} className={clsx(cards.mermaidHost)} />
		</div>
	);
}

function TableView({ overview }: { overview: Overview }) {
	const [sortKey, setSortKey] = useState<SortKey>("progress");
	const rows = sortProjects(overview.projects, sortKey);
	return (
		<table className={clsx(cards.table)}>
			<thead>
				<tr>
					<th className={clsx(cards.cell, cards.head)}>Project</th>
					{sortKeys.map((item) => (
						<th key={item.key} className={clsx(cards.cell, cards.head)}>
							<button
								type="button"
								id={item.id}
								onClick={() => setSortKey(item.key)}
							>
								{item.label}
							</button>
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((project) => (
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

function OverviewPage({
	overview,
	graphSvg,
}: {
	overview: Overview;
	graphSvg: string;
}) {
	const [tab, setTab] = useState(readTab);
	const [notifyPermission, setNotifyPermission] = useState(
		notificationPermission,
	);
	const choose = (next: Tab) => {
		writeTab(next);
		setTab(next);
	};
	const panes = {
		cards: <CardsList overview={overview} />,
		graph: <GraphView overview={overview} svg={graphSvg} />,
		table: <TableView overview={overview} />,
	};
	return (
		<main className={clsx(shell.page)}>
			<h1 className={clsx(shell.title)}>{navLabel.projects}</h1>
			<nav className={clsx(shell.nav)}>
				<a className={clsx(shell.link, shell.linkFocus)} href="/needs-you">
					{navLabel.needsYou}
				</a>
				<a className={clsx(shell.link, shell.linkFocus)} href="/inbox">
					{navLabel.inbox}
				</a>
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
				<a className={clsx(shell.link, shell.linkFocus)} href="/settings">
					{navLabel.settings}
				</a>
				<button
					type="button"
					className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
					onClick={() => {
						void fetch("/api/refresh", { method: "POST" });
					}}
				>
					Refresh
				</button>
				<button
					type="button"
					className={clsx(
						shell.button,
						shell.buttonHover,
						shell.buttonFocus,
						shell.theme,
					)}
					data-theme-toggle=""
				>
					Dark mode
				</button>
			</nav>
			{overview.polling === true ? (
				<p className={clsx(cards.loading)}>Loading projects</p>
			) : overview.error !== null ? (
				<p className={clsx(shell.stale)}>{overview.error}</p>
			) : null}
			<nav className={clsx(shell.nav)} aria-label="Overview tabs">
				{tabs.map((name) => (
					<button
						key={name}
						type="button"
						className={clsx(
							shell.button,
							shell.buttonHover,
							shell.buttonFocus,
							tab === name && shell.pressed,
						)}
						id={`tab-${name}`}
						aria-pressed={tab === name}
						onClick={() => choose(name)}
					>
						{viewLabel[name]}
					</button>
				))}
			</nav>
			{panes[tab]}
		</main>
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
			setOverview((current) => {
				if (current !== null) {
					show(current);
				}
				return current;
			});
		});
		void readOverview().then(show);
		return () => {
			stopOverview();
			stopOpen();
			stopTheme();
		};
	}, []);
	if (overview === null) {
		return null;
	}
	return <OverviewPage overview={overview} graphSvg={graphSvg} />;
}

if (typeof document !== "undefined") {
	const root = document.getElementById("root");
	if (root !== null) {
		createRoot(root).render(<Page />);
	}
}
