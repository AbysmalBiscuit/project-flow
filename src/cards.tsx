import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CrossProjectBlocker, Overview, ProjectCounts } from "./domain.ts";

function projectPath(name: string, ticket?: string): string {
	const path = `/projects/${encodeURIComponent(name)}`;
	if (ticket === undefined) {
		return path;
	}
	return `${path}?ticket=${encodeURIComponent(ticket)}`;
}

function openProject(
	name: string,
	onOpen: (label: string) => void,
	ticket?: string,
): void {
	const path = projectPath(name, ticket);
	const label =
		ticket === undefined ? `Opened ${name}` : `Opened ${name} ${ticket}`;
	window.history.pushState({}, "", path);
	onOpen(label);
}

function openedLabel(): string | null {
	if (!window.location.pathname.startsWith("/projects/")) {
		return null;
	}
	const name = decodeURIComponent(
		window.location.pathname.slice("/projects/".length),
	);
	const ticket = new URLSearchParams(window.location.search).get("ticket");
	return ticket === null ? `Opened ${name}` : `Opened ${name} ${ticket}`;
}

function Chip({
	blocker,
	onOpen,
}: {
	blocker: CrossProjectBlocker;
	onOpen: (label: string) => void;
}) {
	return (
		<a
			className="blocker-chip"
			href={projectPath(blocker.project, blocker.key)}
			onClick={(event) => {
				event.preventDefault();
				openProject(blocker.project, onOpen, blocker.key);
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
	onOpen,
	children,
}: {
	name: string;
	className: string;
	onOpen: (label: string) => void;
	children: string;
}) {
	return (
		<a
			className={className}
			href={projectPath(name)}
			onClick={(event) => {
				event.preventDefault();
				openProject(name, onOpen);
			}}
		>
			{children}
		</a>
	);
}

function CardsList({
	overview,
	opened,
	onOpen,
}: {
	overview: Overview;
	opened: string | null;
	onOpen: (label: string) => void;
}) {
	return (
		<ul>
			{overview.projects.map((project) => (
				<li
					key={`${project.tracker}:${project.name}`}
					className={
						opened === `Opened ${project.name}` ||
						opened?.startsWith(`Opened ${project.name} `) === true
							? "card highlighted"
							: "card"
					}
				>
					<h2>
						<ProjectLink
							name={project.name}
							className="project-link"
							onOpen={onOpen}
						>
							{project.name}
						</ProjectLink>
					</h2>
					<p className="counts">
						Done {project.done} Dropped {project.dropped} Blocked{" "}
						{project.blocked} Backlog {project.backlog} In progress{" "}
						{project.inProgress}
					</p>
					{project.crossProjectBlockers.length === 0 ? null : (
						<p className="blockers">
							{project.crossProjectBlockers.map((blocker) => (
								<Chip
									key={`${blocker.project} ${blocker.key}`}
									blocker={blocker}
									onOpen={onOpen}
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

type MermaidApi = {
	render: (id: string, source: string) => Promise<{ svg: string }>;
};

declare global {
	interface Window {
		mermaid?: MermaidApi;
	}
}

async function renderGraph(overview: Overview): Promise<string> {
	const draw = window.mermaid;
	if (draw === undefined) {
		return "";
	}
	try {
		const drawn = await draw.render(
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
	onOpen: (label: string) => void,
): void {
	for (const project of overview.projects) {
		const id = nodeId(project.name);
		const label = nodeLabel(host, id);
		if (label === null) {
			continue;
		}
		label.id = id;
		label.addEventListener("click", () => openProject(project.name, onOpen));
	}
	for (const edge of edges) {
		const id = edgeId(edge.from, edge.blocker);
		const label = htmlSpan(host, `[data-id="${id}"] span.edgeLabel`);
		if (label === null) {
			continue;
		}
		label.id = id;
		label.addEventListener("click", () =>
			openProject(edge.blocker.project, onOpen, edge.blocker.key),
		);
	}
}

function GraphView({
	overview,
	onOpen,
	svg,
}: {
	overview: Overview;
	onOpen: (label: string) => void;
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
		bindGraph(node, overview, graphEdges(overview), onOpen);
	}, [onOpen, overview, svg]);
	return (
		<div className="graph">
			<div ref={host} className="mermaid-host" />
		</div>
	);
}

function TableView({
	overview,
	onOpen,
}: {
	overview: Overview;
	onOpen: (label: string) => void;
}) {
	const [sortKey, setSortKey] = useState<SortKey>("progress");
	const rows = sortProjects(overview.projects, sortKey);
	return (
		<table>
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
							<ProjectLink
								name={project.name}
								className="project-link"
								onOpen={onOpen}
							>
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
	const [opened, setOpened] = useState(openedLabel);
	const [tab, setTab] = useState(readTab);
	useEffect(() => {
		const onPop = () => setOpened(openedLabel());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
	const choose = (next: Tab) => {
		writeTab(next);
		setTab(next);
	};
	const panes = {
		cards: <CardsList overview={overview} opened={opened} onOpen={setOpened} />,
		graph: <GraphView overview={overview} onOpen={setOpened} svg={graphSvg} />,
		table: <TableView overview={overview} onOpen={setOpened} />,
	};
	return (
		<main>
			<h1>Projects</h1>
			<button
				type="button"
				onClick={() => {
					void fetch("/api/refresh", { method: "POST" });
				}}
			>
				Refresh
			</button>
			{overview.error !== null ? (
				<p className="stale">{overview.error}</p>
			) : null}
			<nav className="tabs">
				{tabs.map((name) => (
					<button
						key={name}
						type="button"
						id={`tab-${name}`}
						aria-pressed={tab === name}
						onClick={() => choose(name)}
					>
						{name[0]?.toUpperCase()}
						{name.slice(1)}
					</button>
				))}
			</nav>
			{opened === null ? null : (
				<p className="opened">
					{opened}{" "}
					<button
						type="button"
						className="back"
						onClick={() => window.history.back()}
					>
						Back
					</button>
				</p>
			)}
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
		const events = new EventSource("/api/events");
		const show = (next: Overview) => {
			setOverview(next);
			void renderGraph(next).then(setGraphSvg);
		};
		events.addEventListener("overview", (event) => {
			show(JSON.parse(event.data) as Overview);
		});
		events.onopen = () => {
			void readOverview().then(show);
		};
		void readOverview().then(show);
		return () => {
			events.close();
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
