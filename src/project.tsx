import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { OutsideBlocker, ProjectReport, TicketView } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { TicketPanel } from "./panel.tsx";
import { closeTicket, openTicket } from "./selection.ts";
import { AppShell } from "./shell.tsx";
import { blockedLabel, navLabel, stateLabel } from "./terms.ts";
import { lightValues } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { board, frame, shell } from "./ui-styles.ts";

const doneCap = 5;

const views = [
	{ id: "board", label: "Board" },
	{ id: "graph", label: "Graph" },
	{ id: "table", label: "Table" },
] as const;

function projectName(): string {
	return decodeURIComponent(
		window.location.pathname.slice("/projects/".length),
	);
}

function highlightKey(): string | null {
	const ticket = new URLSearchParams(window.location.search).get("ticket");
	if (ticket === null || ticket.trim() === "") {
		return null;
	}
	return ticket;
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

function countLine(report: ProjectReport): string {
	const total = report.tickets.length;
	const doneLane = report.lanes.find((lane) => lane.statusType === "done");
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
	return `${done} of ${total} done, ${needs} ${need} you, ${blocked} blocked (${outside} by other projects)`;
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
	selected,
	onOpen,
	onOpenOutside,
}: {
	report: ProjectReport;
	selected: string | null;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: OutsideBlocker) => void;
}) {
	const [shownDone, setShownDone] = useState(false);
	return (
		<div className={clsx(board.lanes)}>
			{report.lanes.map((lane) => (
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

function Page() {
	const [name, setName] = useState(projectName);
	const [ticket, setTicket] = useState(highlightKey);
	const [panelProject, setPanelProject] = useState(projectName);
	const panelProjectRef = useRef(panelProject);
	panelProjectRef.current = panelProject;
	const [panelTracker, setPanelTracker] = useState<"github" | "linear">(
		"github",
	);
	const [open, setOpen] = useState(highlightKey() !== null);
	const [view, setView] = useState("board");
	const [report, setReport] = useState<ProjectReport | null>(null);
	const [panelReport, setPanelReport] = useState<ProjectReport | null>(null);
	const [missing, setMissing] = useState(false);
	useEffect(() => {
		const onPop = () => {
			const next = highlightKey();
			setName(projectName());
			setTicket(next);
			setOpen(next !== null || window.history.state?.panel === true);
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
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
		if (panelProject === name) {
			setPanelReport(report);
			return;
		}
		let stopped = false;
		fetch(`/api/projects/${encodeURIComponent(panelProject)}`)
			.then(async (response) => {
				if (stopped || !response.ok) {
					return;
				}
				setPanelReport((await response.json()) as ProjectReport);
			})
			.catch(() => {});
		return () => {
			stopped = true;
		};
	}, [open, ticket, panelProject, name, report]);
	const source = panelProject === name ? report : panelReport;
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
						<p className={clsx(board.counts)}>{countLine(report)}</p>
					</div>
					<div className={clsx(board.tools)}>
						<button
							type="button"
							className={clsx(board.filter, shell.buttonFocus)}
							aria-label="Filter"
						>
							Filter
							<span className={clsx(board.filterCount)}>
								{report.lanes.length}
							</span>
						</button>
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
									onClick={() => setView(item.id)}
								>
									{item.label}
								</button>
							))}
						</fieldset>
					</div>
				</div>
				<div data-project={report.name} />
				<div className={clsx(board.stage)}>
					{view === "board" ? (
						<Board
							report={report}
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
