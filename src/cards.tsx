import "@xyflow/react/dist/style.css";
import * as stylex from "@stylexjs/stylex";
import { ReactFlowProvider } from "@xyflow/react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { readSettings, writeSettings } from "./client-settings.ts";
import {
	type Configuration,
	type OverviewView,
	overviewFilters,
	overviewSorts,
	overviewViews,
} from "./configuration.ts";
import type {
	CrossProjectBlocker,
	NeedsYouItem,
	Overview,
	PollProgress,
	ProjectCounts,
} from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import {
	askNotificationPermission,
	notificationPermission,
} from "./notify.tsx";
import { OverviewGraph } from "./overview-graph.tsx";
import { mountPage, readPageCache, writePageCache } from "./page-cache.ts";
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
	loadingLabel,
	navLabel,
	overviewControlLabel,
	overviewFilterLabel,
	overviewSortLabel,
	stateLabel,
	tableColumnLabel,
	trackerLabel,
	viewLabel,
} from "./terms.ts";
import { phoneGutter, phoneLayout } from "./tokens.stylex.ts";
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
	if (age < 60) {
		return `${overviewControlLabel.polled} ${age} s ago`;
	}
	const clock = new Date(at).toISOString().slice(11, 16);
	return `${overviewControlLabel.polled} ${clock} UTC`;
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

function ProjectCard({ project }: { project: ProjectCounts }) {
	const id = `project-card-${slug(project.name)}`;
	const total = ticketTotal(project);
	const loading = project.pending === true;
	return (
		<li id={id} className={clsx(cards.card)} aria-busy={loading}>
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
					<h2 className={clsx(cards.nameRow)}>{project.name}</h2>
					<p className={clsx(cards.meta)}>{subtitle(project)}</p>
				</a>
				{project.needsYou === 0 ? null : (
					<span className={clsx(cards.badge)}>{project.needsYou} need you</span>
				)}
			</div>
			{loading ? (
				<p className={clsx(cards.loading)}>{loadingLabel}</p>
			) : (
				<>
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
								<Chip
									key={`${blocker.project} ${blocker.key}`}
									blocker={blocker}
								/>
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
				</>
			)}
		</li>
	);
}

function CardsList({ projects }: { projects: ProjectCounts[] }) {
	return (
		<ul className={clsx(cards.list, phoneGutter.cards)}>
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

function TableView({
	projects,
	sort,
	direction,
	onSort,
}: {
	projects: ProjectCounts[];
	sort: SortKey;
	direction: SortDirection;
	onSort: (sort: SortKey, direction: SortDirection) => void;
}) {
	return (
		<div className={clsx(cards.tableWrap)}>
			<table className={clsx(cards.table)}>
				<thead>
					<tr>
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
					{projects.map((project) => {
						const loading = project.pending === true;
						return (
							<tr
								key={`${project.tracker}:${project.name}`}
								id={`overview-row-${slug(project.name)}`}
								aria-busy={loading}
							>
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
									{loading ? loadingLabel : <ProgressBar project={project} />}
								</td>
								<td className={clsx(cards.cell, cards.number)}>
									{loading ? null : project.statusTypes.backlog}
								</td>
								<td className={clsx(cards.cell, cards.number)}>
									{loading ? null : project.statusTypes.inProgress}
								</td>
								<td className={clsx(cards.cell, cards.number)}>
									{loading ? null : project.statusTypes.inReview}
								</td>
								<td className={clsx(cards.cell, cards.number)}>
									{loading ? null : project.statusTypes.awaitingMerge}
								</td>
								<td className={clsx(cards.cell, cards.number)}>
									{loading ? null : project.needsYou === 0 ? (
										"0"
									) : (
										<span className={clsx(cards.badge)}>
											{project.needsYou}
										</span>
									)}
								</td>
								<td className={clsx(cards.cell)}>
									{loading ? null : (
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
									)}
								</td>
							</tr>
						);
					})}
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
	const root = useRef<HTMLDivElement>(null);
	const gutter = useRef<HTMLSpanElement>(null);
	const [maxHeight, setMaxHeight] = useState<number | null>(null);
	const [shift, setShift] = useState(0);
	useLayoutEffect(() => {
		const node = root.current;
		if (!open || node === null) {
			return;
		}
		const fit = () => {
			const panel = node.querySelector("[id$='-panel']");
			if (!(panel instanceof HTMLElement)) {
				return;
			}
			const box = panel.getBoundingClientRect();
			const inset = gutter.current?.offsetWidth ?? 0;
			const applied = Number.parseFloat(getComputedStyle(panel).left);
			const unshiftedRight =
				box.right - (Number.isFinite(applied) ? applied : 0);
			const overflow = Math.ceil(unshiftedRight - (window.innerWidth - inset));
			setMaxHeight(Math.max(0, Math.floor(window.innerHeight - box.top)));
			setShift(overflow > 0 ? -overflow : 0);
		};
		fit();
		window.addEventListener("resize", fit);
		return () => {
			window.removeEventListener("resize", fit);
		};
	}, [open]);
	return (
		<div className={clsx(cards.menu)} ref={root}>
			<span ref={gutter} className={clsx(cards.gutter)} aria-hidden="true" />
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
				<div
					id={`${id}-panel`}
					{...stylex.props(
						cards.panel,
						maxHeight === null ? null : cards.fit(maxHeight),
						shift === 0 ? null : cards.shift(shift),
					)}
				>
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

function pollLine(progress: PollProgress): string {
	const count = `${progress.done} ${overviewControlLabel.pollProgress} ${progress.total}`;
	if (progress.project === null) {
		return count;
	}
	return `${count}, ${overviewControlLabel.reading} ${progress.project}`;
}

function OverviewPage({
	overview,
	settings,
	progress,
	onSettings,
	onRefresh,
}: {
	overview: Overview;
	settings: Configuration;
	progress: PollProgress | null;
	onSettings: (next: Configuration) => void;
	onRefresh: () => void;
}) {
	const [query, setQuery] = useState("");
	const [menu, setMenu] = useState<"filter" | "sort" | null>(null);
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
	const panes = {
		cards: <CardsList projects={projects} />,
		graph: <OverviewGraph projects={projects} catalogue={overview.projects} />,
		table: (
			<TableView
				projects={projects}
				sort={view.sort}
				direction={view.direction}
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
				<button
					key={item}
					type="button"
					id={`overview-sort-${item}`}
					aria-pressed={view.sort === item}
					className={clsx(cards.choice, shell.buttonFocus)}
					onClick={() =>
						saveView({
							...view,
							sort: item,
							direction: sortDirectionFor(view.sort, item, view.direction),
						})
					}
				>
					<span
						className={clsx(
							cards.choiceMark,
							view.sort === item && cards.markOn,
						)}
						aria-hidden="true"
					/>
					{overviewSortLabel[item]}
				</button>
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
				<button
					key={item}
					type="button"
					id={`overview-filter-${item}`}
					aria-pressed={view.filter === item}
					className={clsx(cards.choice, shell.buttonFocus)}
					onClick={() => saveView({ ...view, filter: item })}
				>
					<span
						className={clsx(
							cards.choiceMark,
							view.filter === item && cards.markOn,
						)}
						aria-hidden="true"
					/>
					{overviewFilterLabel[item]}
				</button>
			))}
		</MenuButton>
	);
	const summary = [
		`${overview.projects.length} ${overviewControlLabel.projects}`,
		`${tickets} ${overviewControlLabel.tickets}`,
		polled,
	]
		.filter((part) => part !== null)
		.join(", ");
	const sectionTitle =
		view.view === "graph" ? "Projects and their blockers" : navLabel.projects;
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
						aria-label={overviewControlLabel.refresh}
						aria-busy={overview.polling === true}
						title={overviewControlLabel.refresh}
						onClick={onRefresh}
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
								className={clsx(cards.need, phoneLayout.cardNeed)}
							>
								<a
									className={clsx(cards.needKey, phoneLayout.cardNeedKey)}
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
						{filterMenu}
						{view.view === "graph" ? null : sortMenu}
					</div>
				</div>
			)}
			{progress !== null && !progress.ended ? (
				<p id="poll-progress" className={clsx(cards.loading)}>
					{pollLine(progress)}
				</p>
			) : overview.polling === true ? (
				<p className={clsx(cards.loading)}>{overviewControlLabel.refreshing}</p>
			) : overview.error !== null ? (
				<p className={clsx(shell.stale)}>{overview.error}</p>
			) : null}
			{overview.tracked === false && overview.polling !== true ? (
				<div id="overview-empty" className={clsx(cards.empty)}>
					<p className={clsx(cards.emptyTitle)}>
						{overviewControlLabel.noneTracked}
					</p>
					<p className={clsx(cards.emptyHint)}>
						{overviewControlLabel.noneTrackedHint}{" "}
						<a
							id="overview-empty-settings"
							className={clsx(cards.emptyLink, shell.linkFocus)}
							href="/settings"
						>
							{navLabel.settings}
						</a>
						.
					</p>
				</div>
			) : (
				panes[view.view]
			)}
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
	const [overview, setOverview] = useState<Overview | null>(
		() => readPageCache("overview") ?? null,
	);
	const [settings, setSettings] = useState<Configuration | null>(
		() => readPageCache("settings") ?? null,
	);
	const [progress, setProgress] = useState<PollProgress | null>(null);
	useEffect(() => {
		const show = (next: Overview) => {
			writePageCache("overview", next);
			setOverview(next);
		};
		const stopOverview = onAppEvent("overview", (event) => {
			show(JSON.parse(event.data) as Overview);
		});
		const stopProgress = onAppEvent("progress", (event) => {
			const next = JSON.parse(event.data) as PollProgress;
			setProgress(next.ended ? null : next);
		});
		const stopOpen = onEventStreamOpen(() => {
			void readOverview().then(show);
		});
		void readOverview().then(show);
		void readSettings().then((loaded) => {
			if (loaded !== null) {
				writePageCache("settings", loaded);
				setSettings(loaded);
			}
		});
		return () => {
			stopOverview();
			stopProgress();
			stopOpen();
		};
	}, []);
	if (overview === null || settings === null) {
		return <PageFrame title={navLabel.overview}>{loadingLabel}</PageFrame>;
	}
	return (
		<OverviewPage
			overview={overview}
			settings={settings}
			progress={progress}
			onSettings={setSettings}
			onRefresh={() => {
				void fetch("/api/refresh", { method: "POST" });
			}}
		/>
	);
}

function mount(): void {
	if (window.location.pathname !== "/") {
		return;
	}
	mountPage((root) => {
		root.render(<Page />);
	});
}

if (typeof document !== "undefined") {
	mount();
	window.addEventListener("project-flow-page", mount);
}
