import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { OutsideBlocker, ProjectReport, TicketView } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { TicketPanel } from "./panel.tsx";
import { PageFrame } from "./shell.tsx";
import { blockedLabel, navLabel, stateLabel } from "./terms.ts";
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
	return new URLSearchParams(window.location.search).get("ticket");
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

function countLine(report: ProjectReport): string {
	const counts = new Map<string, number>();
	for (const ticket of report.tickets) {
		const lane = ticket.lane ?? stateLabel[ticket.state];
		counts.set(lane, (counts.get(lane) ?? 0) + 1);
	}
	const blocked = report.tickets.filter((ticket) => ticket.blocked).length;
	const needs = report.tickets.filter((ticket) => ticket.needsYou).length;
	const parts = report.lanes.map(
		(lane) => `${counts.get(lane.name) ?? 0} ${lane.name}`,
	);
	parts.push(`${blocked} ${blockedLabel.toLowerCase()}`);
	parts.push(`${needs} ${navLabel.needsYou.toLowerCase()}`);
	return parts.join(", ");
}

function laneTickets(report: ProjectReport, lane: string): TicketView[] {
	return report.tickets.filter(
		(ticket) => (ticket.lane ?? stateLabel[ticket.state]) === lane,
	);
}

function Chip({
	label,
	ticketKey,
	onOpen,
}: {
	label: string;
	ticketKey?: string;
	onOpen?: (key: string) => void;
}) {
	if (ticketKey === undefined || onOpen === undefined) {
		return <span className={clsx(board.chip, board.chipStatic)}>{label}</span>;
	}
	return (
		<button
			type="button"
			className={clsx(board.chip, shell.buttonFocus)}
			data-chip={ticketKey}
			onClick={(event) => {
				event.stopPropagation();
				onOpen(ticketKey);
			}}
		>
			{label}
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
	const chips = [
		...(ticket.pull === undefined ? [] : [ticket.pull]),
		...(ticket.needsYou ? [navLabel.needsYou] : []),
		...(ticket.blocked ? [blockedLabel] : []),
		...(ticket.staleStatus === undefined ? [] : [ticket.staleStatus]),
		...(ticket.chips ?? []).filter(
			(chip) => chip !== ticket.staleStatus && chip !== blockedLabel,
		),
	];
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
				{key === null ? null : <span className={clsx(board.key)}>{key}</span>}
				<p className={clsx(board.title)}>{ticket.title}</p>
				{chips.length === 0 && outside.length === 0 ? null : (
					<span className={clsx(board.chips)}>
						{chips.map((chip) => (
							<Chip key={chip} label={chip} />
						))}
						{outside.map((blocker) => (
							<Chip
								key={blocker.key}
								label={blocker.key}
								ticketKey={blocker.key}
								onOpen={() => onOpenOutside(blocker)}
							/>
						))}
					</span>
				)}
			</button>
		</li>
	);
}

function Lane({
	name,
	tickets,
	capped,
	shown,
	onShowAll,
	onOpen,
	onOpenOutside,
}: {
	name: string;
	tickets: TicketView[];
	capped: boolean;
	shown: boolean;
	onShowAll: () => void;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: OutsideBlocker) => void;
}) {
	const visible = capped && !shown ? tickets.slice(0, doneCap) : tickets;
	return (
		<section className={clsx(board.lane)} data-lane={name} aria-label={name}>
			<h2 className={clsx(board.laneTitle)}>
				{name} {tickets.length}
			</h2>
			<ul className={clsx(board.cards)}>
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
	onOpen,
	onOpenOutside,
}: {
	report: ProjectReport;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: OutsideBlocker) => void;
}) {
	const [shownDone, setShownDone] = useState(false);
	return (
		<>
			<p className={clsx(board.counts)}>{countLine(report)}</p>
			<div className={clsx(board.lanes)}>
				{report.lanes.map((lane) => (
					<Lane
						key={lane.id}
						name={lane.name}
						tickets={laneTickets(report, lane.name)}
						capped={lane.statusType === "done"}
						shown={shownDone}
						onShowAll={() => setShownDone(true)}
						onOpen={onOpen}
						onOpenOutside={onOpenOutside}
					/>
				))}
			</div>
		</>
	);
}

function Page() {
	const [name, setName] = useState(projectName);
	const [ticket, setTicket] = useState(highlightKey);
	const [panelProject, setPanelProject] = useState(projectName);
	const [panelTracker, setPanelTracker] = useState<"github" | "linear">(
		"github",
	);
	const [open, setOpen] = useState(false);
	const [view, setView] = useState("board");
	const [report, setReport] = useState<ProjectReport | null>(null);
	const [panelReport, setPanelReport] = useState<ProjectReport | null>(null);
	const [missing, setMissing] = useState(false);
	useEffect(() => {
		const onPop = () => {
			setName(projectName());
			setTicket(highlightKey());
			setOpen(window.history.state?.panel === true);
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
					setPanelTracker(body.tracker);
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
	const outside = [
		...(selected?.outsideBlockers ?? []),
		...(selected?.blocks ?? []),
	];
	if (missing) {
		return <PageFrame title={name}>Project not found</PageFrame>;
	}
	if (report === null) {
		return <PageFrame title={name}>Loading {name}</PageFrame>;
	}
	return (
		<>
			<PageFrame
				wide
				title={report.name}
				filter={
					<select
						className={clsx(frame.select)}
						aria-label="Filter"
						defaultValue="all"
					>
						<option value="all">All lanes</option>
					</select>
				}
				sort={
					<select
						className={clsx(frame.select)}
						aria-label="Sort"
						defaultValue="updated"
					>
						<option value="updated">Updated</option>
					</select>
				}
				search={
					<input
						className={clsx(frame.search)}
						type="search"
						aria-label="Search"
						placeholder="Search"
					/>
				}
				views={views}
				view={view}
				onView={setView}
			>
				<div data-project={report.name} />
				{view === "board" ? (
					<Board
						report={report}
						onOpen={(key) => {
							setPanelProject(report.name);
							setPanelTracker(report.tracker);
							setTicket(key);
							setOpen(true);
						}}
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
			</PageFrame>
			{open && ticket !== null ? (
				<TicketPanel
					tracker={panelTracker}
					project={panelProject}
					ticketKey={ticket}
					{...(selected?.title === undefined ? {} : { title: selected.title })}
					url={
						selected?.key === undefined || selected.key === null
							? undefined
							: trackerUrl(panelTracker, selected.key)
					}
					{...(selected?.state === undefined ? {} : { state: selected.state })}
					blockers={outside}
					onOpenBlocker={(blocker) => {
						setPanelReport(null);
						setPanelProject(blocker.project);
						setPanelTracker(blocker.tracker);
						setTicket(blocker.key);
						setOpen(true);
					}}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
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
