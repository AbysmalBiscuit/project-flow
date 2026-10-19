import mermaid from "mermaid";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./cards.module.css";
import type { CrossProjectBlocker, Overview, ProjectCounts } from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import {
	askNotificationPermission,
	notificationPermission,
} from "./notify.tsx";
import shell from "./shell.module.css";
import { mermaidTheme, watchPageTheme } from "./theme.ts";

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
			className={styles.chip}
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
	{ key: "needsYou", id: "sort-needs-you", label: "Needs you" },
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
		<ul className={styles.list}>
			{overview.projects.map((project) => (
				<li key={`${project.tracker}:${project.name}`} className={styles.card}>
					<h2 className={shell.heading}>
						<ProjectLink name={project.name} className={styles.projectLink}>
							{project.name}
						</ProjectLink>
					</h2>
					{project.error === null ? null : (
						<p className={shell.stale}>{project.error}</p>
					)}
					<p className={styles.counts}>
						<span className={styles.count}>
							<span className={`${styles.swatch} ${styles.done}`} />
							Done {project.done}
						</span>
						<span className={styles.count}>
							<span className={`${styles.swatch} ${styles.dropped}`} />
							Dropped {project.dropped}
						</span>
						<span className={styles.count}>
							<span className={`${styles.swatch} ${styles.blocked}`} />
							Blocked {project.blocked}
						</span>
						<span className={styles.count}>
							<span className={`${styles.swatch} ${styles.backlog}`} />
							Backlog {project.backlog}
						</span>
						<span className={styles.count}>
							<span className={`${styles.swatch} ${styles.inProgress}`} />
							In progress {project.inProgress}
						</span>
						<span className={styles.count}>
							<span className={`${styles.swatch} ${styles.inReview}`} />
							In review {project.inReview}
						</span>
						<span className={styles.count}>
							<span className={`${styles.swatch} ${styles.awaitingMerge}`} />
							Awaiting merge {project.awaitingMerge}
						</span>
						<span className={styles.count}>Needs you {project.needsYou}</span>
					</p>
					{project.tags.length === 0 ? null : (
						<p className={styles.tags}>{project.tags.join(" ")}</p>
					)}
					{project.crossProjectBlockers.length === 0 ? null : (
						<p className={styles.blockers}>
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
		label.addEventListener("click", () => openProject(project.name));
	}
	for (const edge of edges) {
		const id = edgeId(edge.from, edge.blocker);
		const label = htmlSpan(host, `[data-id="${id}"] span.edgeLabel`);
		if (label === null) {
			continue;
		}
		label.id = id;
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
		<div className={styles.graph}>
			<div ref={host} className={styles.mermaidHost} />
		</div>
	);
}

function TableView({ overview }: { overview: Overview }) {
	const [sortKey, setSortKey] = useState<SortKey>("progress");
	const rows = sortProjects(overview.projects, sortKey);
	return (
		<table className={styles.table}>
			<thead>
				<tr>
					<th>Project</th>
					{sortKeys.map((item) => (
						<th key={item.key}>
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
						<td>
							<ProjectLink name={project.name} className={styles.projectLink}>
								{project.name}
							</ProjectLink>
						</td>
						<td>{project.progress}%</td>
						<td>{project.needsYou}</td>
						<td>{project.crossProjectBlockers.length}</td>
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
		<main className={shell.page}>
			<h1 className={shell.title}>Projects</h1>
			<nav className={shell.nav}>
				<a className={shell.link} href="/needs-you">
					Needs you
				</a>
				<a className={shell.link} href="/inbox">
					Inbox
				</a>
				{notifyPermission === "default" ? (
					<button
						type="button"
						id="notify-permission"
						className={shell.button}
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
					className={shell.button}
					onClick={() => {
						void fetch("/api/refresh", { method: "POST" });
					}}
				>
					Refresh
				</button>
				<button
					type="button"
					className={`${shell.button} ${shell.theme}`}
					data-theme-toggle=""
				>
					Dark mode
				</button>
			</nav>
			{overview.polling === true ? (
				<p className={styles.loading}>Loading projects</p>
			) : overview.error !== null ? (
				<p className={shell.stale}>{overview.error}</p>
			) : null}
			<nav className={shell.nav} aria-label="Overview tabs">
				{tabs.map((name) => (
					<button
						key={name}
						type="button"
						className={shell.button}
						id={`tab-${name}`}
						aria-pressed={tab === name}
						onClick={() => choose(name)}
					>
						{name[0]?.toUpperCase()}
						{name.slice(1)}
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
