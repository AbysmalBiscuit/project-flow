import mermaid from "mermaid";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
	Diagram,
	ProjectReport,
	TicketState,
	TicketView,
} from "./domain.ts";
import { NeedsItem } from "./needs-item.tsx";
import { TicketPanel } from "./panel.tsx";

function projectName(): string {
	return decodeURIComponent(
		window.location.pathname.slice("/projects/".length),
	);
}

function highlightKey(): string | null {
	return new URLSearchParams(window.location.search).get("ticket");
}

function openPath(project: string, ticket: string | null): string {
	const path = `/projects/${encodeURIComponent(project)}`;
	return ticket === null
		? path
		: `${path}?ticket=${encodeURIComponent(ticket)}`;
}

function openProject(project: string, ticket: string | null): void {
	window.history.pushState({}, "", openPath(project, ticket));
	window.dispatchEvent(new PopStateEvent("popstate"));
}

function TicketLine({
	ticket,
	highlight,
	onOpen,
}: {
	ticket: TicketView;
	highlight: string | null;
	onOpen: (key: string) => void;
}) {
	const marked = highlight !== null && highlight === ticket.key;
	const key = ticket.key;
	return (
		<li
			className={marked ? "ticket highlighted" : "ticket"}
			data-ticket={key ?? ""}
		>
			{key === null ? (
				<>
					{ticket.title} {ticket.state}
				</>
			) : (
				<button
					type="button"
					className="ticket-open"
					onClick={() => onOpen(key)}
				>
					{key} {ticket.title} {ticket.state}
				</button>
			)}
		</li>
	);
}

function NodeLine({
	node,
	ticket,
}: {
	node: Diagram["nodes"][number];
	ticket: string | null;
}) {
	const marked = ticket !== null && ticket === node.ticket;
	if (node.dashed) {
		return (
			<li>
				<a
					className={marked ? "dashed-node highlighted" : "dashed-node"}
					data-node={node.id}
					href={openPath(node.project, node.ticket)}
					onClick={(event) => {
						event.preventDefault();
						openProject(node.project, node.ticket);
					}}
				>
					{node.label}
				</a>
			</li>
		);
	}
	return (
		<li
			className={marked ? "highlighted" : undefined}
			data-node={node.id}
			data-ticket={node.ticket ?? ""}
		>
			{node.label}
		</li>
	);
}

const stateLabels: Record<TicketState, string> = {
	done: "Done",
	dropped: "Dropped",
	blocked: "Blocked",
	inProgress: "In progress",
	inReview: "In review",
	awaitingMerge: "Awaiting merge",
	backlog: "Backlog",
};

function StateLegend({ theme }: { theme: boolean }) {
	const kinds = [
		...Object.entries(stateLabels),
		...(theme ? [["theme", "Theme"]] : []),
		["dashed", "Cross-project blocker"],
	];
	return (
		<ul className="state-legend" aria-label="Diagram key">
			{kinds.map(([kind, label]) => (
				<li key={kind}>
					<span className={`swatch ${kind}`} />
					{label}
				</li>
			))}
		</ul>
	);
}

function DiagramView({
	diagram,
	ticket,
}: {
	diagram: Diagram;
	ticket: string | null;
}) {
	return (
		<figure className="diagram" data-diagram={diagram.id}>
			<figcaption>{diagram.title}</figcaption>
			<pre key={diagram.definition} className="mermaid">
				{diagram.definition}
			</pre>
			<ul className="nodes">
				{diagram.nodes.map((node) => (
					<NodeLine key={node.id} node={node} ticket={ticket} />
				))}
			</ul>
		</figure>
	);
}

function Report({
	report,
	ticket,
	onOpen,
}: {
	report: ProjectReport;
	ticket: string | null;
	onOpen: (key: string) => void;
}) {
	return (
		<main className="project-page" data-project={report.name}>
			<p>
				<a className="back" href="/">
					Projects
				</a>
			</p>
			<h1>{report.name}</h1>
			<nav className="report-nav" aria-label="Report sections">
				{report.sections.map((section) => (
					<a key={section.id} href={`#${section.id}`}>
						{section.title}
					</a>
				))}
			</nav>
			{report.sections.map((section) => (
				<section key={section.id} className="report-section" id={section.id}>
					<h2>{section.title}</h2>
					{section.id === "featureMap" ? (
						<StateLegend
							theme={
								section.diagrams?.some((diagram) =>
									diagram.nodes.some((node) => node.state === "theme"),
								) ?? false
							}
						/>
					) : null}
					{section.text === undefined ? null : (
						<p className="summary">{section.text}</p>
					)}
					{section.items === undefined ? null : (
						<ul>
							{section.items.map((item) => (
								<TicketLine
									key={`${item.key ?? ""} ${item.title}`}
									ticket={item}
									highlight={ticket}
									onOpen={onOpen}
								/>
							))}
						</ul>
					)}
					{section.needsYou === undefined ? null : (
						<ul className="needs-you-list">
							{section.needsYou.map((item) => (
								<NeedsItem key={item.key} item={item} onOpen={onOpen} />
							))}
						</ul>
					)}
					{section.diagrams === undefined
						? null
						: section.diagrams.map((diagram) => (
								<DiagramView
									key={diagram.id}
									diagram={diagram}
									ticket={ticket}
								/>
							))}
				</section>
			))}
		</main>
	);
}

function Page() {
	const [name, setName] = useState(projectName);
	const [ticket, setTicket] = useState(highlightKey);
	const [open, setOpen] = useState(false);
	const [report, setReport] = useState<ProjectReport | null>(null);
	const [missing, setMissing] = useState(false);
	useEffect(() => {
		const onPop = () => {
			setName(projectName());
			setTicket(highlightKey());
			setOpen(false);
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
					setReport((await response.json()) as ProjectReport);
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
		const events = new EventSource("/api/events");
		events.addEventListener("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			events.close();
		};
	}, [name]);
	const highlightBlocker = useCallback(
		(project: string, key: string): void => {
			if (project === name) {
				setTicket(key);
				setOpen(false);
				return;
			}
			openProject(project, key);
		},
		[name],
	);
	useEffect(() => {
		if (report === null) {
			return;
		}
		mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
		const nodes = document.querySelectorAll<HTMLElement>(".mermaid");
		if (nodes.length === 0) {
			return;
		}
		let stopped = false;
		const bound: { drawn: SVGGElement; open: () => void }[] = [];
		void mermaid.run({ nodes }).then(() => {
			if (stopped) {
				return;
			}
			for (const section of report.sections) {
				for (const diagram of section.diagrams ?? []) {
					const figure = document.querySelector(
						`figure[data-diagram="${diagram.id}"]`,
					);
					if (figure === null) {
						continue;
					}
					for (const node of diagram.nodes) {
						if (!node.dashed || node.ticket === null) {
							continue;
						}
						const drawn = [...figure.querySelectorAll("g.node")].find((item) =>
							item.id.startsWith(`flowchart-${node.id}-`),
						);
						if (!(drawn instanceof SVGGElement)) {
							continue;
						}
						const ticket = node.ticket;
						const project = node.project;
						const open = () => {
							highlightBlocker(project, ticket);
						};
						drawn.style.cursor = "pointer";
						drawn.addEventListener("click", open);
						bound.push({ drawn, open });
					}
				}
			}
		});
		return () => {
			stopped = true;
			for (const { drawn, open } of bound) {
				drawn.removeEventListener("click", open);
			}
		};
	}, [report, highlightBlocker]);
	if (missing) {
		return <main>Project not found</main>;
	}
	if (report === null) {
		return <main>Loading {name}</main>;
	}
	return (
		<>
			<Report
				report={report}
				ticket={ticket}
				onOpen={(key) => {
					setTicket(key);
					setOpen(true);
				}}
			/>
			{open && ticket !== null ? (
				<TicketPanel
					tracker={report.tracker}
					project={
						report.tracker === "github" && ticket.includes("/")
							? (ticket.split("#")[0] ?? report.name)
							: report.name
					}
					ticketKey={ticket}
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
