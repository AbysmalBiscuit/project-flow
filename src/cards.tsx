import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CrossProjectBlocker, Overview, ProjectCounts } from "./domain.ts";

function projectPath(name: string, ticket: string): string {
	return `/projects/${encodeURIComponent(name)}?ticket=${encodeURIComponent(ticket)}`;
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
	const path = projectPath(blocker.project, blocker.key);
	const label = `Opened ${blocker.project} ${blocker.key}`;
	return (
		<a
			className="blocker-chip"
			href={path}
			onClick={(event) => {
				event.preventDefault();
				window.history.pushState({}, "", path);
				onOpen(label);
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
	const stored = localStorage.getItem(tabKey);
	return tabs.find((tab) => tab === stored) ?? "cards";
}

function progressOf(project: ProjectCounts): number {
	const total =
		project.done +
		project.dropped +
		project.blocked +
		project.backlog +
		project.inProgress;
	if (total === 0) {
		return 0;
	}
	return Math.round((project.done / total) * 100);
}

function sortProjects(
	projects: ProjectCounts[],
	key: SortKey,
): ProjectCounts[] {
	const value = (project: ProjectCounts): number => {
		if (key === "progress") {
			return progressOf(project);
		}
		if (key === "needsYou") {
			return project.blocked;
		}
		return project.crossProjectBlockers.length;
	};
	return [...projects].sort((left, right) => {
		const delta = value(right) - value(left);
		if (delta !== 0) {
			return delta;
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

function openProject(
	name: string,
	onOpen: (label: string) => void,
	ticket?: string,
): void {
	const path =
		ticket === undefined
			? `/projects/${encodeURIComponent(name)}`
			: projectPath(name, ticket);
	const label =
		ticket === undefined ? `Opened ${name}` : `Opened ${name} ${ticket}`;
	window.history.pushState({}, "", path);
	onOpen(label);
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
	const path = `/projects/${encodeURIComponent(name)}`;
	return (
		<a
			className={className}
			href={path}
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

function GraphView({
	overview,
	onOpen,
}: {
	overview: Overview;
	onOpen: (label: string) => void;
}) {
	const edges = overview.projects.flatMap((project) =>
		project.crossProjectBlockers.map((blocker) => ({
			from: project.name,
			blocker,
		})),
	);
	return (
		<div className="graph">
			{overview.projects.map((project) => (
				<span
					key={`${project.tracker}:${project.name}`}
					id={`node-${slug(project.name)}`}
				>
					<ProjectLink
						name={project.name}
						className="graph-node"
						onOpen={onOpen}
					>
						{project.name}
					</ProjectLink>
				</span>
			))}
			{edges.map(({ from, blocker }) => (
				<a
					key={`${from} ${blocker.tracker} ${blocker.key}`}
					id={`edge-${slug(blocker.key)}`}
					className="graph-edge"
					href={projectPath(blocker.project, blocker.key)}
					onClick={(event) => {
						event.preventDefault();
						openProject(blocker.project, onOpen, blocker.key);
					}}
				>
					{`${from} blocked by ${blocker.key}`}
				</a>
			))}
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
	const first = rows[0];
	return (
		<div>
			{first === undefined ? null : (
				<p className="sort-order">First {first.name}</p>
			)}
			<table>
				<thead>
					<tr>
						<th>Project</th>
						<th>
							<button
								type="button"
								id="sort-progress"
								onClick={() => setSortKey("progress")}
							>
								Progress
							</button>
						</th>
						<th>
							<button
								type="button"
								id="sort-needs-you"
								onClick={() => setSortKey("needsYou")}
							>
								Needs you
							</button>
						</th>
						<th>
							<button
								type="button"
								id="sort-blockers"
								onClick={() => setSortKey("blockers")}
							>
								Cross-project blockers
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((project) => (
						<tr
							key={`${project.tracker}:${project.name}`}
							id={`row-${slug(project.name)}`}
						>
							<td>
								<ProjectLink
									name={project.name}
									className="project-link"
									onOpen={onOpen}
								>
									{project.name}
								</ProjectLink>
							</td>
							<td>{progressOf(project)}%</td>
							<td>{project.blocked}</td>
							<td>{project.crossProjectBlockers.length}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function OverviewPage({ overview }: { overview: Overview }) {
	const [opened, setOpened] = useState(openedLabel);
	const [tab, setTab] = useState(readTab);
	useEffect(() => {
		const onPop = () => setOpened(openedLabel());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
	const choose = (next: Tab) => {
		localStorage.setItem(tabKey, next);
		setTab(next);
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
				<button
					type="button"
					id="tab-cards"
					aria-pressed={tab === "cards"}
					onClick={() => choose("cards")}
				>
					Cards
				</button>
				<button
					type="button"
					id="tab-graph"
					aria-pressed={tab === "graph"}
					onClick={() => choose("graph")}
				>
					Graph
				</button>
				<button
					type="button"
					id="tab-table"
					aria-pressed={tab === "table"}
					onClick={() => choose("table")}
				>
					Table
				</button>
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
			{tab === "cards" ? (
				<CardsList overview={overview} opened={opened} onOpen={setOpened} />
			) : null}
			{tab === "graph" ? (
				<GraphView overview={overview} onOpen={setOpened} />
			) : null}
			{tab === "table" ? (
				<TableView overview={overview} onOpen={setOpened} />
			) : null}
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
	useEffect(() => {
		const events = new EventSource("/api/events");
		events.addEventListener("overview", (event) => {
			setOverview(JSON.parse(event.data) as Overview);
		});
		events.onopen = () => {
			void readOverview().then(setOverview);
		};
		void readOverview().then(setOverview);
		return () => {
			events.close();
		};
	}, []);
	if (overview === null) {
		return null;
	}
	return <OverviewPage overview={overview} />;
}

if (typeof document !== "undefined") {
	const root = document.getElementById("root");
	if (root !== null) {
		createRoot(root).render(<Page />);
	}
}
