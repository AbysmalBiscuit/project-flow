import "@xyflow/react/dist/style.css";
import * as stylex from "@stylexjs/stylex";
import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { readSettings, writeSettings } from "./client-settings.ts";
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
import { OverviewGraph } from "./overview-graph.tsx";
import { openProject, projectPath } from "./paths.ts";
import {
	barSegments,
	SegmentedBar,
	ticketTotal,
	trackerName,
} from "./progress-bar.tsx";
import { PageFrame, type PageView, SearchGlyph } from "./shell.tsx";
import {
	actionLabel,
	navLabel,
	overviewControlLabel,
	overviewFilterLabel,
	overviewSortLabel,
	stateLabel,
	tableColumnLabel,
	trackerLabel,
	viewLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards, frame, shell } from "./ui-styles.ts";

function blockerTicket(blocker: CrossProjectBlocker): string {
	if (blocker.key.includes("#")) {
		return blocker.key;
	}
	return `${blocker.project}#${blocker.key}`;
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
			Blocked by {blockerTicket(blocker)}
		</a>
	);
}

type FilterKey = OverviewView["filter"];
type SortKey = OverviewView["sort"];
type SortDirection = OverviewView["direction"];

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
	if (key === "project") {
		return project.name;
	}
	if (key === "tracker") {
		return trackerLabel[project.tracker];
	}
	if (key === "progress") {
		return project.progress;
	}
	if (key === "backlog") {
		return project.statusTypes.backlog;
	}
	if (key === "inProgress") {
		return project.statusTypes.inProgress;
	}
	if (key === "inReview") {
		return project.statusTypes.inReview;
	}
	if (key === "awaitingMerge") {
		return project.statusTypes.awaitingMerge;
	}
	if (key === "needsYou") {
		return project.needsYou;
	}
	return project.crossProjectBlockers.map(blockerTicket).join(" ");
}

function sortDirectionFor(
	current: SortKey,
	next: SortKey,
	direction: SortDirection,
): SortDirection {
	if (current === next) {
		return direction;
	}
	if (next === "needsYou" || next === "blockedBy") {
		return "desc";
	}
	return "asc";
}

function sortProjects(
	projects: ProjectCounts[],
	key: SortKey,
	direction: SortDirection,
): ProjectCounts[] {
	return [...projects].sort((left, right) => {
		const leftValue = sortValue(left, key);
		const rightValue = sortValue(right, key);
		const delta =
			typeof leftValue === "string" || typeof rightValue === "string"
				? String(leftValue).localeCompare(String(rightValue))
				: leftValue - rightValue;
		if (delta !== 0) {
			return direction === "asc" ? delta : -delta;
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
		view.direction,
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

function subtitle(project: ProjectCounts): string {
	if (project.ref.tracker === "linear") {
		return `${trackerName(project.tracker)}, ${project.ref.project}`;
	}
	if ("repo" in project.ref) {
		return `${trackerName(project.tracker)}, ${project.ref.repo}`;
	}
	return `${trackerName(project.tracker)}, ${project.ref.owner}/${project.ref.project}`;
}

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

const tableColumns: {
	key: SortKey;
	label: string;
	number: boolean;
}[] = [
	{ key: "project", label: tableColumnLabel.project, number: false },
	{ key: "tracker", label: tableColumnLabel.tracker, number: false },
	{ key: "progress", label: tableColumnLabel.progress, number: false },
	{ key: "backlog", label: tableColumnLabel.backlog, number: true },
	{ key: "inProgress", label: tableColumnLabel.inProgress, number: true },
	{ key: "inReview", label: tableColumnLabel.inReview, number: true },
	{
		key: "awaitingMerge",
		label: tableColumnLabel.awaitingMerge,
		number: true,
	},
	{ key: "needsYou", label: tableColumnLabel.needsYou, number: true },
	{ key: "blockedBy", label: tableColumnLabel.blockedBy, number: false },
];

function SortMark({ direction }: { direction: "asc" | "desc" | "none" }) {
	const up = direction === "asc";
	const down = direction === "desc";
	return (
		<svg
			viewBox="0 0 12 12"
			aria-hidden="true"
			className={clsx(cards.mark)}
			fill="currentColor"
		>
			<path d="M6 1.5 9.2 5.2H2.8z" opacity={up ? 1 : 0.35} />
			<path d="M6 10.5 2.8 6.8h6.4z" opacity={down ? 1 : 0.35} />
		</svg>
	);
}

function ProgressBar({ project }: { project: ProjectCounts }) {
	const total = ticketTotal(project);
	return (
		<div className={clsx(cards.progressCell)}>
			<div
				className={clsx(cards.barThin)}
				role="progressbar"
				aria-valuenow={project.progress}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={`${project.name} progress`}
			>
				{barSegments.map((item) =>
					project.statusTypes[item.key] === 0 || total === 0 ? null : (
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
			<span>{project.progress}%</span>
		</div>
	);
}

function Star({ filled }: { filled: boolean }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(frame.glyph)}
			fill={filled ? "currentColor" : "none"}
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinejoin="round"
		>
			<path d="M12 3.2 14.7 8.7 20.8 9.6 16.4 13.9 17.4 20 12 17.1 6.6 20 7.6 13.9 3.2 9.6 9.3 8.7 12 3.2z" />
		</svg>
	);
}

function TableView({
	projects,
	sort,
	direction,
	onPin,
	onSort,
}: {
	projects: ProjectCounts[];
	sort: SortKey;
	direction: SortDirection;
	onPin: (project: ProjectCounts) => void;
	onSort: (sort: SortKey, direction: SortDirection) => void;
}) {
	return (
		<div className={clsx(cards.tableWrap)}>
			<table className={clsx(cards.table)}>
				<thead>
					<tr>
						<th className={clsx(cards.cell, cards.head)} />
						{tableColumns.map((item) => {
							const active = sort === item.key;
							return (
								<th
									key={item.key}
									className={clsx(
										cards.cell,
										cards.head,
										item.number && cards.number,
									)}
									aria-sort={
										active
											? direction === "asc"
												? "ascending"
												: "descending"
											: "none"
									}
								>
									<button
										type="button"
										id={`sort-${item.key}`}
										className={clsx(cards.sort)}
										onClick={() =>
											onSort(
												item.key,
												active && direction === "asc" ? "desc" : "asc",
											)
										}
									>
										{item.label}
										<SortMark direction={active ? direction : "none"} />
									</button>
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{projects.map((project) => (
						<tr
							key={`${project.tracker}:${project.name}`}
							id={`overview-row-${slug(project.name)}`}
						>
							<td className={clsx(cards.cell)}>
								<button
									type="button"
									id={`pin-${slug(project.name)}`}
									className={clsx(cards.star, project.pinned && cards.pinned)}
									aria-pressed={project.pinned}
									aria-label={`${overviewControlLabel.pinned} ${project.name}`}
									onClick={() => onPin(project)}
								>
									<Star filled={project.pinned} />
								</button>
							</td>
							<td className={clsx(cards.cell, cards.name)}>
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
							<td className={clsx(cards.cell)}>
								{trackerLabel[project.tracker]}
							</td>
							<td className={clsx(cards.cell)}>
								<ProgressBar project={project} />
							</td>
							<td className={clsx(cards.cell, cards.number)}>
								{project.statusTypes.backlog}
							</td>
							<td className={clsx(cards.cell, cards.number)}>
								{project.statusTypes.inProgress}
							</td>
							<td className={clsx(cards.cell, cards.number)}>
								{project.statusTypes.inReview}
							</td>
							<td className={clsx(cards.cell, cards.number)}>
								{project.statusTypes.awaitingMerge}
							</td>
							<td className={clsx(cards.cell, cards.number)}>
								{project.needsYou === 0 ? (
									"0"
								) : (
									<span className={clsx(cards.badge)}>{project.needsYou}</span>
								)}
							</td>
							<td className={clsx(cards.cell)}>
								<div className={clsx(cards.chips)}>
									{project.crossProjectBlockers.map((blocker) => (
										<a
											key={`${blocker.project} ${blocker.key}`}
											className={clsx(
												cards.chip,
												cards.blockerChip,
												cards.chipHover,
											)}
											href={projectPath(blocker.project, blocker.key)}
										>
											{blockerTicket(blocker)}
										</a>
									))}
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function NotifyIcon() {
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
			<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5" />
			<path d="M5 16.5h14" />
			<path d="M10 19a2 2 0 0 0 4 0" />
		</svg>
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
		graph: <OverviewGraph projects={projects} catalogue={overview.projects} />,
		table: (
			<TableView
				projects={projects}
				sort={view.sort}
				direction={view.direction}
				onPin={togglePin}
				onSort={(sort, direction) => saveView({ ...view, sort, direction })}
			/>
		),
	};
	const views: PageView[] = overviewViews.map((name) => ({
		id: name,
		label: viewLabel[name],
	}));
	const tickets = overview.projects.reduce(
		(sum, project) => sum + ticketTotal(project),
		0,
	);
	const sortMenu = (
		<MenuButton
			id="overview-sort"
			label={
				view.sort === "needsYou"
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
						id={`overview-sort-${item}`}
						name="overview-sort"
						value={item}
						checked={view.sort === item}
						onChange={() =>
							saveView({
								...view,
								sort: item,
								direction: sortDirectionFor(view.sort, item, view.direction),
							})
						}
					/>
					{overviewSortLabel[item]}
				</label>
			))}
		</MenuButton>
	);
	const filterMenu = (
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
	);
	const pinnedCount = overview.projects.filter(
		(project) => project.pinned,
	).length;
	const summary = [
		`${overview.projects.length} ${overviewControlLabel.projects}`,
		`${tickets} ${overviewControlLabel.tickets}`,
		polled,
	]
		.filter((part) => part !== null)
		.join(", ");
	const sectionTitle =
		view.view === "graph" ? "Projects and their blockers" : navLabel.projects;
	const pinnedMenu = (
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
	);
	const page = (
		<PageFrame
			title={navLabel.overview}
			subtitle={summary}
			filter={undefined}
			sort={undefined}
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
			actions={
				<div className={clsx(frame.actions)}>
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
					{notifyPermission === "default" &&
					typeof Notification !== "undefined" ? (
						<button
							type="button"
							id="notify-permission"
							className={clsx(frame.notify, shell.buttonFocus)}
							onClick={() => {
								void askNotificationPermission().finally(() => {
									setNotifyPermission(notificationPermission());
								});
							}}
						>
							<NotifyIcon />
							Allow notifications
						</button>
					) : null}
				</div>
			}
		>
			{view.view === "table" ? (
				<div className={clsx(cards.toolbar)}>
					<div>
						<p className={clsx(cards.tableLabel)}>{navLabel.projects}</p>
					</div>
					<span className={clsx(cards.grow)} />
					{pinnedMenu}
					{filterMenu}
				</div>
			) : null}
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
			{view.view === "table" ? null : (
				<div className={clsx(cards.section)}>
					<h2 className={clsx(cards.sectionLabel)}>{sectionTitle}</h2>
					<div className={clsx(cards.controls)}>
						{pinnedMenu}
						{filterMenu}
						{view.view === "graph" ? null : sortMenu}
					</div>
				</div>
			)}
			{overview.polling === true ? (
				<p className={clsx(cards.loading)}>Loading projects</p>
			) : overview.error !== null ? (
				<p className={clsx(shell.stale)}>{overview.error}</p>
			) : null}
			{panes[view.view]}
			{view.view === "graph" ? (
				<p className={clsx(cards.caption)}>
					{overviewControlLabel.edgeCaption}
				</p>
			) : null}
		</PageFrame>
	);
	return view.view === "graph" ? (
		<ReactFlowProvider>{page}</ReactFlowProvider>
	) : (
		page
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
