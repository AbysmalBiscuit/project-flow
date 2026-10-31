import "@xyflow/react/dist/style.css";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { Button, type IconName } from "./button.tsx";
import { Choice } from "./choice.tsx";
import type { Configuration } from "./configuration.ts";
import { control, textControl } from "./control-styles.ts";
import type {
	CrossProjectBlocker,
	Overview,
	PollProgress,
	ProjectCounts,
} from "./domain.ts";
import { OverviewSearch } from "./focus-controls.tsx";
import { useFocusView } from "./focus.ts";
import { Loading, PollLoading } from "./loading.tsx";
import {
	askNotificationPermission,
	notificationPermission,
} from "./notify.tsx";
import { OverviewGraph } from "./overview-graph.tsx";
import {
	overviewFilters,
	overviewSorts,
	type OverviewView,
	overviewViews,
} from "./overview-view.ts";
import { openProject, projectPath } from "./paths.ts";
import {
	pollLine,
	postRefresh,
	RefreshButton,
	usePollProgress,
} from "./poll-freshness.tsx";
import { SegmentedBar, ticketTotal, trackerName } from "./progress-bar.tsx";
import { pinRef } from "./project-ref.ts";
import {
	configurationOf,
	pageQuery,
	pageQueryClient,
	useSaveSettings,
} from "./queries.ts";
import { PageFrame, type PageView } from "./shell.tsx";
import { stateTones } from "./state-tone.ts";
import { storeHoldsRead } from "./stored-page.ts";
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
import { attentionItemId, itemId, outsideKey } from "./ticket-key.ts";
import { phoneGutter, phoneLayout } from "./tokens.stylex.ts";
import { cards, shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

function blockerTicket(blocker: CrossProjectBlocker): string {
	return outsideKey(blocker.project, blocker.key);
}

function Chip({ blocker }: { blocker: CrossProjectBlocker }) {
	return (
		<a
			className={clsx(cards.chip, control.tint, control.focusInside)}
			href={projectPath(blocker.project, blocker)}
		>
			Blocked by {blockerTicket(blocker)}
		</a>
	);
}

function fitsInRow(node: HTMLElement, row: HTMLElement): boolean {
	const rowBox = row.getBoundingClientRect();
	const box = node.getBoundingClientRect();
	return box.bottom <= rowBox.bottom + 1 && box.right <= rowBox.right + 1;
}

function moreLabel(hidden: number): string {
	return `+${hidden} ${overviewControlLabel.moreBlockers}`;
}

function hidePast(items: HTMLElement[], visible: number): void {
	for (const [index, item] of items.entries()) {
		item.hidden = index >= visible;
	}
}

function visibleChipCount(row: HTMLElement, items: HTMLElement[]): number {
	const reserve = row.querySelector<HTMLElement>("[data-more]");
	hidePast(items, items.length);
	if (reserve !== null) {
		reserve.hidden = true;
	}
	let visible = items.length;
	while (visible > 0) {
		const last = items[visible - 1];
		if (last === undefined || fitsInRow(last, row)) {
			break;
		}
		visible -= 1;
	}
	hidePast(items, visible);
	if (visible === items.length || reserve === null) {
		return visible;
	}
	let hidden = items.length - visible;
	for (let pass = 0; pass < items.length; pass += 1) {
		reserve.textContent = moreLabel(hidden);
		reserve.hidden = false;
		while (visible > 0 && !fitsInRow(reserve, row)) {
			visible -= 1;
			hidePast(items, visible);
		}
		const next = items.length - visible;
		if (next === hidden) {
			return visible;
		}
		hidden = next;
	}
	return visible;
}

function BlockerRow({ project }: { project: ProjectCounts }) {
	const row = useRef<HTMLParagraphElement>(null);
	const [hidden, setHidden] = useState(0);
	const chips = project.crossProjectBlockers.length;
	const tags = project.tags.length;
	const unlinked = project.unlinkedPrs.length;
	const chipList = [
		...project.crossProjectBlockers.map((blocker) =>
			itemId(blocker.project, blocker.key),
		),
		...project.tags,
		String(unlinked),
	].join("\n");

	useLayoutEffect(() => {
		const node = row.current;
		if (node === null) {
			return;
		}
		void chipList;
		const measure = () => {
			const items = [...node.querySelectorAll<HTMLElement>("[data-chip]")];
			const visible = visibleChipCount(node, items);
			setHidden(items.length - visible);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		let cancelled = false;
		void document.fonts.ready.then(() => {
			if (!cancelled) {
				measure();
			}
		});
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [chipList]);

	if (chips === 0 && tags === 0 && unlinked === 0) {
		return null;
	}
	return (
		<p ref={row} className={clsx(cards.blockers)}>
			{project.crossProjectBlockers.map((blocker) => (
				<span key={itemId(blocker.project, blocker.key)} data-chip="">
					<Chip blocker={blocker} />
				</span>
			))}
			{project.tags.map((tag) => (
				<span key={tag} data-chip="" className={clsx(cards.tagChip)}>
					{tag}
				</span>
			))}
			{unlinked === 0 ? null : (
				<span data-chip="" className={clsx(cards.quiet)}>
					{unlinked} {overviewControlLabel.unlinked}
				</span>
			)}
			<MoreChip project={project.name} hidden={hidden} />
		</p>
	);
}

function MoreChip({ project, hidden }: { project: string; hidden: number }) {
	const label = moreLabel(hidden);
	return (
		<a
			hidden={hidden === 0}
			data-more=""
			className={clsx(cards.chip, control.tint, control.focusInside)}
			href={projectPath(project)}
			aria-label={label}
			onClick={(event) => {
				event.preventDefault();
				openProject(project);
			}}
		>
			{label}
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

function slug(value: string): string {
	const cleaned = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return cleaned === "" ? "item" : cleaned;
}

function subtitle(project: ProjectCounts): string {
	return `${trackerName(project.tracker)}, ${pinRef(project.ref).key}`;
}

const legendSegments = [
	{ key: "backlog", label: stateLabel.backlog, tone: stateTones.backlog },
	{
		key: "inProgress",
		label: stateLabel.inProgress,
		tone: stateTones.inProgress,
	},
	{ key: "inReview", label: stateLabel.inReview, tone: stateTones.inReview },
	{
		key: "awaitingMerge",
		label: stateLabel.awaitingMerge,
		tone: stateTones.awaitingMerge,
	},
] as const;

function Legend({ project }: { project: ProjectCounts }) {
	return (
		<p className={clsx(cards.counts)}>
			{legendSegments.map((item) =>
				project.statusTypes[item.key] === 0 ? null : (
					<span key={item.key} className={clsx(cards.count)}>
						<span
							className={clsx(cards.swatch, item.tone)}
							data-state={item.key}
						/>
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
					className={clsx(cards.projectLink, control.link, ...textControl)}
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
				<Loading />
			) : (
				<>
					{project.error === null ? null : (
						<p
							className={clsx(shell.stale, shell.cardError)}
							title={project.error}
						>
							{project.error}
						</p>
					)}
					<p className={clsx(cards.doneLine)}>
						<span>
							{project.done} of {total} done
						</span>
						<span>{project.progress}%</span>
					</p>
					<SegmentedBar project={project} />
					<Legend project={project} />
					<BlockerRow project={project} />
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

function ProgressCell({ project }: { project: ProjectCounts }) {
	return (
		<div className={clsx(cards.progressCell)}>
			<SegmentedBar project={project} variant="cell" />
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
										className={clsx(cards.sort, ...textControl)}
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
										className={clsx(
											cards.projectLink,
											control.link,
											...textControl,
										)}
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
									{loading ? (
										<Loading inline />
									) : (
										<ProgressCell project={project} />
									)}
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
													key={itemId(blocker.project, blocker.key)}
													className={clsx(
														cards.chip,
														cards.blockerChip,
														control.focus,
														control.tint,
													)}
													href={projectPath(blocker.project, blocker)}
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

function MenuButton({
	id,
	label,
	icon,
	count,
	open,
	onToggle,
	children,
}: {
	id: string;
	label: string;
	icon?: IconName;
	count?: number;
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
	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			event.preventDefault();
			onToggle();
			document.getElementById(id)?.focus();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
		};
	}, [open, id, onToggle]);
	return (
		<div className={clsx(cards.menu)} ref={root}>
			<span ref={gutter} className={clsx(cards.gutter)} aria-hidden="true" />
			<Button
				id={id}
				label={label}
				icon={icon}
				count={count}
				aria-expanded={open}
				aria-controls={`${id}-panel`}
				onClick={onToggle}
			/>
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

function OverviewPage({
	overview,
	settings,
	progress,
	fetching,
}: {
	overview: Overview;
	settings: Configuration;
	progress: PollProgress | null;
	fetching: boolean;
}) {
	const [query, setQuery] = useState("");
	const focus = useFocusView();
	const [menu, setMenu] = useState<"filter" | "sort" | null>(null);
	const [notifyPermission, setNotifyPermission] = useState(
		notificationPermission,
	);
	const view = settings.overview;
	const projects = useMemo(
		() => shownProjects(overview, view, query),
		[overview, view, query],
	);
	const refreshing = fetching || overview.polling === true;
	const needsQuery = useQuery(pageQuery.needsYou);
	const needs = needsQuery.data ?? [];
	const save = useSaveSettings({ refetchProjects: false, optimistic: true });
	const savePatch = (patch: (current: Configuration) => Configuration) => {
		void save
			.mutateAsync(patch)
			.catch(() => pageQueryClient.invalidateQueries(pageQuery.settings));
	};
	const saveView = (next: OverviewView) => {
		savePatch((current) => ({ ...current, overview: next }));
		setMenu(null);
	};
	const panes = {
		cards: <CardsList projects={projects} />,
		graph: <OverviewGraph projects={projects} focus={focus} />,
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
			icon="arrow-up-down"
			label={`${overviewControlLabel.sort}: ${
				view.sort === "needsYou"
					? overviewControlLabel.needsYouFirst
					: overviewSortLabel[view.sort]
			}`}
			open={menu === "sort"}
			onToggle={() => setMenu(menu === "sort" ? null : "sort")}
		>
			{overviewSorts.map((item) => (
				<Choice
					key={item}
					id={`overview-sort-${item}`}
					label={overviewSortLabel[item]}
					on={view.sort === item}
					onClick={() =>
						saveView({
							...view,
							sort: item,
							direction: sortDirectionFor(view.sort, item, view.direction),
						})
					}
				/>
			))}
		</MenuButton>
	);
	const filterMenu = (
		<MenuButton
			id="overview-filter"
			icon="filter"
			label={overviewControlLabel.filter}
			count={view.filter === "all" ? 0 : 1}
			open={menu === "filter"}
			onToggle={() => setMenu(menu === "filter" ? null : "filter")}
		>
			{overviewFilters.map((item) => (
				<Choice
					key={item}
					id={`overview-filter-${item}`}
					label={overviewFilterLabel[item]}
					on={view.filter === item}
					onClick={() => saveView({ ...view, filter: item })}
				/>
			))}
		</MenuButton>
	);
	const summary = [
		`${overview.projects.length} ${overviewControlLabel.projects}`,
		`${tickets} ${overviewControlLabel.tickets}`,
	].join(", ");
	const sectionTitle =
		view.view === "graph" ? "Projects and their blockers" : navLabel.projects;
	const page = (
		<PageFrame
			title={navLabel.overview}
			subtitle={summary}
			tools={
				<>
					<RefreshButton
						id="overview-refresh"
						queryKey={pageQuery.overview.queryKey}
						refreshing={refreshing}
						onRefresh={() => postRefresh(pageQuery.overview.queryKey)}
					/>
					<OverviewSearch query={query} onQuery={setQuery} focus={focus} />
					{filterMenu}
					{sortMenu}
				</>
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
				notifyPermission === "default" &&
				typeof Notification !== "undefined" ? (
					<Button
						id="notify-permission"
						icon="bell"
						label="Allow notifications"
						onClick={() => {
							void askNotificationPermission().finally(() => {
								setNotifyPermission(notificationPermission());
							});
						}}
					/>
				) : undefined
			}
		>
			{view.view === "table" ? (
				<div className={clsx(cards.toolbar)}>
					<div>
						<p className={clsx(cards.tableLabel)}>{navLabel.projects}</p>
					</div>
				</div>
			) : null}
			{needs.length === 0 ||
			view.view !== "cards" ||
			overview.needsYouHidden === true ? null : (
				<section>
					<div className={clsx(cards.section)}>
						<h2 className={clsx(cards.sectionLabel)}>{navLabel.needsYou}</h2>
						<a
							className={clsx(cards.viewAll, ...textControl)}
							href="/needs-you"
						>
							View all
						</a>
					</div>
					<ul className={clsx(cards.needs)}>
						{needs.slice(0, 4).map((item) => (
							<li
								key={attentionItemId(item)}
								className={clsx(cards.need, phoneLayout.cardNeed)}
							>
								<a
									className={clsx(
										cards.needKey,
										phoneLayout.cardNeedKey,
										...textControl,
									)}
									href={projectPath(item.project, item)}
								>
									{outsideKey(item.project, item.key)}
								</a>
								<a
									className={clsx(cards.needTitle, ...textControl)}
									href={projectPath(item.project, item)}
								>
									{item.headline}
								</a>
								<a
									className={clsx(cards.pill, control.soft, control.focus)}
									href={projectPath(item.project, item)}
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
				</div>
			)}
			{progress !== null && !progress.ended ? (
				<p id="poll-progress" className={clsx(cards.loading)}>
					{pollLine(progress)}
				</p>
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
							className={clsx(cards.emptyLink, ...textControl)}
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

export function Page() {
	const overviewQuery = useQuery(pageQuery.overview);
	const settingsQuery = useQuery({
		...pageQuery.settings,
		select: configurationOf,
	});
	const progress = usePollProgress();
	const overview = overviewQuery.data ?? null;
	const settings = settingsQuery.data ?? null;
	const stored = overview !== null && storeHoldsRead(overview);
	if (
		overview === null ||
		settings === null ||
		(overview.polling === true && !stored)
	) {
		return (
			<PageFrame title={navLabel.overview}>
				<PollLoading />
			</PageFrame>
		);
	}
	return (
		<OverviewPage
			overview={overview}
			settings={settings}
			progress={progress}
			fetching={overviewQuery.isFetching || settingsQuery.isFetching}
		/>
	);
}
