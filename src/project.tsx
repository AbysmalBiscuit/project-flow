import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProjectViewSettings } from "./configuration.ts";
import type {
	CrossProjectBlocker,
	NeedsYouItem,
	OutsideBlocker,
	ProjectReport,
	TicketView,
} from "./domain.ts";
import { sameTicketKey } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { TicketPanel } from "./panel.tsx";
import { closeTicket, openTicket } from "./selection.ts";
import { AppShell } from "./shell.tsx";
import { blockedLabel, navLabel, stateLabel } from "./terms.ts";
import { lightValues } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { board, frame, shell } from "./ui-styles.ts";
import {
	laneAgeCap,
	savedProjectView,
	visibleLaneNames,
} from "./view-settings.ts";

const doneCap = 5;

const views = [
	{ id: "board", label: "Board" },
	{ id: "graph", label: "Graph" },
	{ id: "table", label: "Table" },
] as const;

type OpenView = ProjectViewSettings["openView"];

const emptyView = savedProjectView({}, "");

function isOpenView(value: string): value is OpenView {
	return views.some((item) => item.id === value);
}

function projectName(): string {
	return decodeURIComponent(
		window.location.pathname.slice("/projects/".length),
	);
}

function queryValue(name: string): string | null {
	const value = new URLSearchParams(window.location.search).get(name);
	if (value === null || value.trim() === "") {
		return null;
	}
	return value;
}

function highlightKey(): string | null {
	return queryValue("ticket");
}

function panelProjectName(): string {
	return queryValue("panelProject") ?? projectName();
}

function panelTrackerName(): CrossProjectBlocker["tracker"] {
	return queryValue("panelTracker") === "linear" ? "linear" : "github";
}

function clearTicketQuery(): void {
	const url = new URL(window.location.href);
	if (!url.searchParams.has("ticket")) {
		return;
	}
	url.searchParams.delete("ticket");
	const next = `${url.pathname}${url.search}${url.hash}`;
	window.history.replaceState(window.history.state, "", next);
}

function trackerUrl(
	tracker: "github" | "linear",
	key: string,
): string | undefined {
	if (tracker === "github" && key.includes("#")) {
		return `https://github.com/${key.replace("#", "/issues/")}`;
	}
	if (tracker === "linear") {
		return `https://linear.app/issue/${key}`;
	}
	return undefined;
}

function needsYouItem(
	report: ProjectReport | null,
	tracker: "github" | "linear",
	project: string,
	key: string,
): NeedsYouItem | null {
	if (
		report === null ||
		report.tracker !== tracker ||
		report.name !== project
	) {
		return null;
	}
	const section = report.sections.find((item) => item.id === "needsYou");
	return (
		section?.needsYou?.find(
			(item) =>
				item.tracker === tracker &&
				item.project === project &&
				sameTicketKey(item.key, key),
		) ?? null
	);
}

function panelBlockers(
	ticket: TicketView | undefined,
	source: ProjectReport | null,
	project: string,
	tracker: "github" | "linear",
): OutsideBlocker[] {
	if (ticket === undefined) {
		return [];
	}
	const outside = ticket.outsideBlockers ?? [];
	const resolved: OutsideBlocker[] = [];
	for (const key of ticket.blockers) {
		const known = outside.find(
			(blocker) => blocker.key.toLowerCase() === key.toLowerCase(),
		);
		if (known !== undefined) {
			resolved.push(known);
			continue;
		}
		const local = source?.tickets.find(
			(item) => item.key?.toLowerCase() === key.toLowerCase(),
		);
		resolved.push({
			tracker,
			project,
			key,
			title: local?.title.trim() || key,
		});
	}
	return resolved;
}

function visibleLanes(
	report: ProjectReport,
	view: ProjectViewSettings,
): ProjectReport["lanes"] {
	const names = new Set(
		visibleLaneNames(report.lanes, view.shownLanes).map((name) =>
			name.toLowerCase(),
		),
	);
	return report.lanes.filter((lane) => names.has(lane.name.toLowerCase()));
}

function countLine(report: ProjectReport, view: ProjectViewSettings): string {
	const total = report.tickets.length;
	const visible = visibleLanes(report, view);
	const doneLane = visible.find((lane) => lane.statusType === "done");
	const done =
		doneLane === undefined
			? report.tickets.filter((ticket) => ticket.state === "done").length
			: laneTickets(report, doneLane.name).length;
	const needs = report.tickets.filter((ticket) => ticket.needsYou).length;
	const blocked = report.tickets.filter((ticket) => ticket.blocked).length;
	const outside = report.tickets.filter(
		(ticket) => (ticket.outsideBlockers ?? []).length > 0,
	).length;
	const need = needs === 1 ? "needs" : "need";
	const lanes = visible.map((lane) => lane.name).join(", ");
	return `${done} of ${total} done, ${needs} ${need} you, ${blocked} blocked (${outside} by other projects). Lanes: ${lanes}`;
}

function laneTickets(report: ProjectReport, lane: string): TicketView[] {
	return report.tickets.filter(
		(ticket) => (ticket.lane ?? stateLabel[ticket.state]) === lane,
	);
}

function shortKey(key: string): string {
	const mark = key.lastIndexOf("#");
	return mark === -1 ? key : key.slice(mark);
}

function Chip({
	label,
	ticketKey,
	outside,
	onOpen,
}: {
	label: string;
	ticketKey?: string;
	outside?: boolean;
	onOpen?: (key: string) => void;
}) {
	if (ticketKey === undefined || onOpen === undefined) {
		return <span className={clsx(board.chip, board.chipStatic)}>{label}</span>;
	}
	return (
		<button
			type="button"
			className={clsx(
				board.chip,
				outside && board.chipOutside,
				shell.buttonFocus,
			)}
			data-chip={ticketKey}
			onClick={(event) => {
				event.stopPropagation();
				onOpen(ticketKey);
			}}
		>
			{label}
			{outside ? " ↗" : ""}
		</button>
	);
}

function Card({
	ticket,
	onOpen,
	onOpenOutside,
}: {
	ticket: TicketView;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: OutsideBlocker) => void;
}) {
	const key = ticket.key;
	const outside = ticket.outsideBlockers ?? [];
	const outsideKeys = new Set(
		outside.map((blocker) => blocker.key.toLowerCase()),
	);
	const local = ticket.blockers.filter(
		(blocker) => !outsideKeys.has(blocker.toLowerCase()),
	);
	return (
		<li>
			<button
				type="button"
				className={clsx(
					board.card,
					board.cardHover,
					board.cardFocus,
					ticket.blocked && board.cardBlocked,
				)}
				data-ticket={key ?? ""}
				onClick={() => {
					if (key !== null) {
						onOpen(key);
					}
				}}
			>
				<span className={clsx(board.meta)}>
					{key === null ? (
						<span />
					) : (
						<span className={clsx(board.key)}>{shortKey(key)}</span>
					)}
					{ticket.pull === undefined ? null : (
						<span className={clsx(board.pull)}>{ticket.pull}</span>
					)}
				</span>
				<p className={clsx(board.title)}>{ticket.title}</p>
				{local.length === 0 &&
				outside.length === 0 &&
				!ticket.needsYou ? null : (
					<span className={clsx(board.chips)}>
						{local.map((blocker) => (
							<Chip
								key={blocker}
								label={`${blockedLabel} by ${shortKey(blocker)}`}
								ticketKey={blocker}
								onOpen={onOpen}
							/>
						))}
						{outside.map((blocker) => (
							<Chip
								key={blocker.key}
								label={blocker.key}
								ticketKey={blocker.key}
								outside
								onOpen={() => onOpenOutside(blocker)}
							/>
						))}
						{ticket.needsYou ? (
							<span className={clsx(board.chip, board.chipNeeds)}>
								{navLabel.needsYou}
							</span>
						) : null}
					</span>
				)}
			</button>
		</li>
	);
}

const laneMarks: Record<string, typeof board.markBacklog> = {
	[lightValues.done.toLowerCase()]: board.markDone,
	[lightValues.dropped.toLowerCase()]: board.markDropped,
	[lightValues.blocked.toLowerCase()]: board.markBlocked,
	[lightValues.backlog.toLowerCase()]: board.markBacklog,
	[lightValues.inProgress.toLowerCase()]: board.markInProgress,
	[lightValues.inReview.toLowerCase()]: board.markInReview,
	[lightValues.awaitingMerge.toLowerCase()]: board.markAwaitingMerge,
};

function laneMark(colour: string) {
	return laneMarks[colour.trim().toLowerCase()] ?? board.markBacklog;
}

function Lane({
	name,
	colour,
	tickets,
	capped,
	shown,
	reveal,
	onShowAll,
	onOpen,
	onOpenOutside,
}: {
	name: string;
	colour: string;
	tickets: TicketView[];
	capped: boolean;
	shown: boolean;
	reveal: string | null;
	onShowAll: () => void;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: OutsideBlocker) => void;
}) {
	const selectedHidden =
		capped && !shown && reveal !== null
			? tickets.slice(doneCap).filter((ticket) => ticket.key === reveal)
			: [];
	const visible =
		capped && !shown
			? [...tickets.slice(0, doneCap), ...selectedHidden]
			: tickets;
	return (
		<section
			className={clsx(board.lane, capped && board.laneDone)}
			data-lane={name}
			aria-label={name}
		>
			<h2 className={clsx(board.laneTitle)}>
				<span
					className={clsx(board.laneMark, laneMark(colour))}
					data-lane-colour={colour}
				/>
				{name} {tickets.length}
			</h2>
			<ul className={clsx(board.cards, capped && !shown && board.cardsClip)}>
				{visible.map((ticket) => (
					<Card
						key={`${ticket.key ?? ""} ${ticket.title}`}
						ticket={ticket}
						onOpen={onOpen}
						onOpenOutside={onOpenOutside}
					/>
				))}
			</ul>
			{capped && !shown && tickets.length > doneCap ? (
				<button
					type="button"
					className={clsx(
						shell.button,
						shell.buttonHover,
						shell.buttonFocus,
						board.showAll,
					)}
					data-show-all={name}
					onClick={onShowAll}
				>
					Show all
				</button>
			) : null}
		</section>
	);
}

function Board({
	report,
	settings,
	selected,
	onOpen,
	onOpenOutside,
}: {
	report: ProjectReport;
	settings: ProjectViewSettings;
	selected: string | null;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: OutsideBlocker) => void;
}) {
	const [shownDone, setShownDone] = useState(false);
	return (
		<div className={clsx(board.lanes)}>
			{visibleLanes(report, settings).map((lane) => (
				<Lane
					key={lane.id}
					name={lane.name}
					colour={lane.colour}
					tickets={laneTickets(report, lane.name)}
					capped={lane.statusType === "done"}
					shown={shownDone}
					reveal={selected}
					onShowAll={() => setShownDone(true)}
					onOpen={onOpen}
					onOpenOutside={onOpenOutside}
				/>
			))}
		</div>
	);
}

function FilterMenu({
	report,
	view,
	open,
	onOpen,
}: {
	report: ProjectReport;
	view: ProjectViewSettings;
	open: boolean;
	onOpen: (next: boolean) => void;
}) {
	const shown = visibleLaneNames(report.lanes, view.shownLanes);
	return (
		<div>
			<button
				type="button"
				id="project-filter"
				className={clsx(board.filter, shell.buttonFocus)}
				aria-label="Filter"
				aria-expanded={open}
				onClick={() => onOpen(!open)}
			>
				Filter
				<span className={clsx(board.filterCount)}>{shown.length}</span>
			</button>
		</div>
	);
}

function FilterPanel({
	report,
	view,
	onChange,
}: {
	report: ProjectReport;
	view: ProjectViewSettings;
	onChange: (next: ProjectViewSettings) => void;
}) {
	const shown = new Set(
		visibleLaneNames(report.lanes, view.shownLanes).map((name) =>
			name.toLowerCase(),
		),
	);
	const people = [
		...new Set(
			report.tickets.flatMap((ticket) =>
				(ticket.assignees ?? []).map((name) => name.trim()),
			),
		),
	].filter((name) => name !== "");
	const picked = new Set(view.assignees.map((name) => name.toLowerCase()));
	const [ageDraft, setAgeDraft] = useState<Record<string, string>>({});
	return (
		<div className={clsx(board.menu, board.menuBelow)} id="project-filter-menu">
			<p className={clsx(board.menuLabel)}>Lanes</p>
			{report.lanes.map((lane) => (
				<label key={lane.id} className={clsx(board.menuRow)}>
					<span>{lane.name}</span>
					<input
						type="checkbox"
						data-lane-toggle={lane.name}
						checked={shown.has(lane.name.toLowerCase())}
						onChange={(event) => {
							const names = report.lanes.flatMap((item) =>
								item.name.toLowerCase() === lane.name.toLowerCase()
									? event.target.checked
										? [item.name]
										: []
									: shown.has(item.name.toLowerCase())
										? [item.name]
										: [],
							);
							onChange({ ...view, shownLanes: names });
						}}
					/>
				</label>
			))}
			<p className={clsx(board.menuLabel)}>Max age</p>
			{report.lanes.map((lane) => (
				<label key={`${lane.id}-age`} className={clsx(board.menuRow)}>
					<span>{lane.name}</span>
					<input
						type="number"
						min={0}
						className={clsx(board.age)}
						aria-label={`${lane.name} max age`}
						data-lane-age={lane.name}
						value={
							ageDraft[lane.name] ??
							String(laneAgeCap(view.maxAgeDays, lane.name, lane.statusType))
						}
						placeholder={
							laneAgeCap(view.maxAgeDays, lane.name, lane.statusType) === 0
								? "unlimited"
								: undefined
						}
						onChange={(event) => {
							const raw = event.target.value;
							const days = Number(raw);
							if (!Number.isInteger(days) || days < 0) {
								setAgeDraft((current) => ({ ...current, [lane.name]: raw }));
								return;
							}
							setAgeDraft((current) => {
								const next = { ...current };
								delete next[lane.name];
								return next;
							});
							onChange({
								...view,
								maxAgeDays: { ...view.maxAgeDays, [lane.name]: days },
							});
						}}
					/>
				</label>
			))}
			<label className={clsx(board.menuRow)}>
				<span>Needs you only</span>
				<input
					type="checkbox"
					data-needs-you-only=""
					checked={view.needsYouOnly}
					onChange={(event) =>
						onChange({ ...view, needsYouOnly: event.target.checked })
					}
				/>
			</label>
			<label className={clsx(board.menuRow)}>
				<span>Blocked only</span>
				<input
					type="checkbox"
					data-blocked-only=""
					checked={view.blockedOnly}
					onChange={(event) =>
						onChange({ ...view, blockedOnly: event.target.checked })
					}
				/>
			</label>
			<p className={clsx(board.menuLabel)}>Assignees</p>
			{people.map((person) => (
				<label key={person} className={clsx(board.menuRow)}>
					<span>{person}</span>
					<input
						type="checkbox"
						data-assignee={person}
						checked={picked.has(person.toLowerCase())}
						onChange={(event) => {
							const next = event.target.checked
								? [...view.assignees, person]
								: view.assignees.filter(
										(name) => name.toLowerCase() !== person.toLowerCase(),
									);
							onChange({ ...view, assignees: next });
						}}
					/>
				</label>
			))}
		</div>
	);
}

function Page() {
	const [name, setName] = useState(projectName);
	const [ticket, setTicket] = useState(highlightKey);
	const [panelProject, setPanelProject] = useState(panelProjectName);
	const panelProjectRef = useRef(panelProject);
	panelProjectRef.current = panelProject;
	const [panelTracker, setPanelTracker] =
		useState<CrossProjectBlocker["tracker"]>(panelTrackerName);
	const [open, setOpen] = useState(highlightKey() !== null);
	const [view, setView] = useState<OpenView>("board");
	const [settings, setSettings] = useState<ProjectViewSettings>(emptyView);
	const [filterOpen, setFilterOpen] = useState(false);
	const [report, setReport] = useState<ProjectReport | null>(null);
	const [panelReport, setPanelReport] = useState<ProjectReport | null>(null);
	const [missing, setMissing] = useState(false);
	const saveChain = useRef(Promise.resolve());
	const saveGeneration = useRef(0);
	useEffect(() => {
		const onPop = () => {
			const next = highlightKey();
			setName(projectName());
			setPanelProject(panelProjectName());
			setPanelTracker(panelTrackerName());
			setTicket(next);
			setOpen(next !== null || window.history.state?.panel === true);
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
	useEffect(() => {
		let stopped = false;
		const loaded = name;
		fetch("/api/settings")
			.then(async (response) => {
				if (stopped || !response.ok) {
					return;
				}
				const body = (await response.json()) as {
					projectViews?: Record<string, ProjectViewSettings>;
				};
				const saved = savedProjectView(body.projectViews ?? {}, loaded);
				setSettings(saved);
				setView(saved.openView);
			})
			.catch(() => {});
		return () => {
			stopped = true;
		};
	}, [name]);
	useEffect(() => {
		const path = `/api/projects/${encodeURIComponent(name)}`;
		let stopped = false;
		const load = () => {
			fetch(path)
				.then(async (response) => {
					if (stopped) {
						return;
					}
					if (!response.ok) {
						setReport(null);
						setMissing(true);
						return;
					}
					setMissing(false);
					const body = (await response.json()) as ProjectReport;
					setReport(body);
					setPanelTracker((current) =>
						panelProjectRef.current === name ? body.tracker : current,
					);
				})
				.catch(() => {
					if (!stopped) {
						setReport(null);
						setMissing(true);
					}
				});
		};
		setMissing(false);
		load();
		const stop = onAppEvent("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			stop();
		};
	}, [name]);
	useEffect(() => {
		if (!open || ticket === null) {
			return;
		}
		let stopped = false;
		const path = `/api/projects/${encodeURIComponent(panelProject)}?view=all`;
		const load = () => {
			fetch(path)
				.then(async (response) => {
					if (stopped || !response.ok) {
						return;
					}
					const body = (await response.json()) as ProjectReport;
					setPanelReport(body);
					setPanelTracker(body.tracker);
				})
				.catch(() => {});
		};
		load();
		const stop = onAppEvent("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			stop();
		};
	}, [open, ticket, panelProject]);
	const source = panelReport;
	const selected =
		source === null || ticket === null
			? undefined
			: source.tickets.find((item) => item.key === ticket);
	const incoming = panelBlockers(selected, source, panelProject, panelTracker);
	const outgoing = selected?.blocks ?? [];
	if (missing) {
		return (
			<AppShell>
				<main className={clsx(frame.page, frame.wide)}>Project not found</main>
			</AppShell>
		);
	}
	if (report === null) {
		return (
			<AppShell>
				<main className={clsx(frame.page, frame.wide)}>Loading {name}</main>
			</AppShell>
		);
	}
	const saveView = (next: ProjectViewSettings) => {
		const project = name;
		const generation = saveGeneration.current + 1;
		saveGeneration.current = generation;
		setSettings(next);
		setView(next.openView);
		const write = saveChain.current.then(async () => {
			if (generation !== saveGeneration.current) {
				return;
			}
			const response = await fetch("/api/settings");
			if (!response.ok || generation !== saveGeneration.current) {
				return;
			}
			const current: unknown = await response.json();
			if (
				current === null ||
				typeof current !== "object" ||
				generation !== saveGeneration.current
			) {
				return;
			}
			const body = current as {
				projectViews?: Record<string, ProjectViewSettings>;
			};
			const projectViews = { ...(body.projectViews ?? {}) };
			const key =
				Object.keys(projectViews).find(
					(item) => item.toLowerCase() === project.toLowerCase(),
				) ?? project;
			projectViews[key] = next;
			const saved = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...body, projectViews }),
			});
			if (!saved.ok || generation !== saveGeneration.current) {
				return;
			}
			const written = (await saved.json()) as {
				projectViews?: Record<string, ProjectViewSettings>;
			};
			if (generation !== saveGeneration.current) {
				return;
			}
			const confirmed = savedProjectView(written.projectViews ?? {}, project);
			setSettings(confirmed);
			setView(confirmed.openView);
		});
		saveChain.current = write.catch(() => {});
	};
	const openTicketInPanel = (key: string) => {
		setPanelProject(report.name);
		setPanelTracker(report.tracker);
		setTicket(key);
		setOpen(true);
		openTicket({
			tracker: report.tracker,
			project: report.name,
			key,
		});
	};
	return (
		<AppShell>
			<main className={clsx(frame.page, frame.wide, frame.fill)}>
				<div className={clsx(board.head)}>
					<div className={clsx(board.identity)}>
						<p className={clsx(board.crumb)}>{navLabel.overview} /</p>
						<h1 className={clsx(board.name)}>{report.name}</h1>
						<p className={clsx(board.counts)}>{countLine(report, settings)}</p>
					</div>
				</div>
				<div className={clsx(board.toolbar)}>
					<div className={clsx(board.filterSlot)}>
						<FilterMenu
							report={report}
							view={settings}
							open={filterOpen}
							onOpen={setFilterOpen}
						/>
					</div>
					<input
						id="project-search"
						className={clsx(board.find)}
						type="search"
						aria-label="Search"
						placeholder="Search"
						value={settings.search}
						onChange={(event) =>
							saveView({ ...settings, search: event.target.value })
						}
					/>
					<fieldset className={clsx(board.views)}>
						<legend className={clsx(frame.legend)}>Views</legend>
						{views.map((item) => (
							<button
								key={item.id}
								type="button"
								id={`view-${item.id}`}
								className={clsx(
									board.view,
									shell.buttonFocus,
									view === item.id && board.viewOn,
								)}
								aria-pressed={view === item.id}
								onClick={() => {
									if (!isOpenView(item.id)) {
										return;
									}
									saveView({ ...settings, openView: item.id });
								}}
							>
								{item.label}
							</button>
						))}
					</fieldset>
				</div>
				{filterOpen ? (
					<FilterPanel report={report} view={settings} onChange={saveView} />
				) : null}
				<div data-project={report.name} data-open-view={view} />
				<div className={clsx(board.stage)}>
					{view === "board" ? (
						<Board
							report={report}
							settings={settings}
							selected={open ? ticket : null}
							onOpen={openTicketInPanel}
							onOpenOutside={(blocker) => {
								setPanelReport(null);
								setPanelProject(blocker.project);
								setPanelTracker(blocker.tracker);
								setTicket(blocker.key);
								setOpen(true);
							}}
						/>
					) : (
						<p className={clsx(board.placeholder)}>{view}</p>
					)}
					{open && ticket !== null ? (
						<TicketPanel
							key={`${panelTracker}:${panelProject}:${ticket}`}
							tracker={panelTracker}
							project={panelProject}
							ticketKey={ticket}
							{...(selected?.title === undefined
								? {}
								: { title: selected.title })}
							url={
								selected?.key === undefined || selected.key === null
									? undefined
									: trackerUrl(panelTracker, selected.key)
							}
							{...(selected?.state === undefined
								? {}
								: { state: selected.state })}
							lane={selected?.lane}
							laneColour={
								report.lanes.find((lane) => lane.name === selected?.lane)
									?.colour
							}
							blockers={incoming}
							blocks={outgoing}
							item={needsYouItem(source, panelTracker, panelProject, ticket)}
							onOpenBlocker={(blocker) => {
								setPanelReport(null);
								setPanelProject(blocker.project);
								setPanelTracker(blocker.tracker);
								setTicket(blocker.key);
								setOpen(true);
							}}
							onClose={() => {
								clearTicketQuery();
								closeTicket();
								setOpen(false);
							}}
						/>
					) : null}
				</div>
			</main>
		</AppShell>
	);
}

function mount(): void {
	const root = document.getElementById("root");
	if (root === null) {
		return;
	}
	createRoot(root).render(<Page />);
}

mount();
