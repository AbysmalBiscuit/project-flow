import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
	Diagram,
	ProjectReport,
	TicketState,
	TicketView,
} from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { NeedsItem } from "./needs-item.tsx";
import { type OpenedTicket, openTicket } from "./selection.ts";
import { PageFrame } from "./shell.tsx";
import { stateLabel } from "./terms.ts";
import { mermaidTheme, watchPageTheme } from "./theme.ts";
import { clsx } from "./ui.ts";
import { frame, project as page, shell } from "./ui-styles.ts";

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

function openDrawnTicket(ticket: OpenedTicket): void {
	openProject(ticket.project, ticket.key);
	openTicket(ticket);
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
			className={clsx(page.ticket, marked && page.highlighted)}
			data-ticket={key ?? ""}
		>
			{key === null ? (
				<>
					{ticket.title} {ticket.state}
				</>
			) : (
				<button
					type="button"
					className={clsx(page.ticketOpen, page.ticketHover)}
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
					className={clsx(page.dashedNode, marked && page.highlighted)}
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
			className={marked ? clsx(page.highlighted) : undefined}
			data-node={node.id}
			data-ticket={node.ticket ?? ""}
		>
			{node.label}
		</li>
	);
}

const stateSwatches: {
	kind: TicketState;
	swatch: typeof page.done;
}[] = [
	{ kind: "done", swatch: page.done },
	{ kind: "dropped", swatch: page.dropped },
	{ kind: "inProgress", swatch: page.inProgress },
	{ kind: "inReview", swatch: page.inReview },
	{ kind: "awaitingMerge", swatch: page.awaitingMerge },
	{ kind: "backlog", swatch: page.backlog },
];

function StateLegend({ theme }: { theme: boolean }) {
	return (
		<ul className={clsx(page.legend)} aria-label="Diagram key">
			{stateSwatches.map((item) => (
				<li key={item.kind} className={clsx(page.legendItem)}>
					<span className={clsx(page.swatch, item.swatch)} />
					{stateLabel[item.kind]}
				</li>
			))}
			{theme ? (
				<li className={clsx(page.legendItem)}>
					<span className={clsx(page.swatch, page.theme)} />
					Theme
				</li>
			) : null}
			<li className={clsx(page.legendItem)}>
				<span className={clsx(page.swatch, page.dashed)} />
				Cross-project blocker
			</li>
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
		<figure className={clsx(page.diagram)} data-diagram={diagram.id}>
			<figcaption>{diagram.title}</figcaption>
			<pre
				key={diagram.definition}
				className="mermaid"
				data-definition={diagram.definition}
			>
				{diagram.definition}
			</pre>
			<ul className={clsx(page.nodes)}>
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
		<PageFrame
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
			views={[
				{ id: "board", label: "Board" },
				{ id: "graph", label: "Graph" },
				{ id: "table", label: "Table" },
			]}
			view="board"
		>
			<div data-project={report.name} />
			<nav className={clsx(page.reportNav)} aria-label="Report sections">
				{report.sections.map((section) => (
					<a
						key={section.id}
						className={clsx(page.reportLink)}
						href={`#${section.id}`}
					>
						{section.title}
					</a>
				))}
			</nav>
			{report.sections.map((section) => (
				<section
					key={section.id}
					className={clsx(page.section)}
					id={section.id}
				>
					<h2 className={clsx(shell.heading)}>{section.title}</h2>
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
						<p className={clsx(page.summary)}>{section.text}</p>
					)}
					{section.items === undefined ? null : (
						<ul className={clsx(page.tickets)}>
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
						<ul>
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
		</PageFrame>
	);
}

function Page() {
	const [name, setName] = useState(projectName);
	const [ticket, setTicket] = useState(highlightKey);
	const [report, setReport] = useState<ProjectReport | null>(null);
	const [missing, setMissing] = useState(false);
	const [diagramTheme, setDiagramTheme] = useState(mermaidTheme);
	useEffect(() => {
		const onPop = () => {
			setName(projectName());
			setTicket(highlightKey());
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
		const stop = onAppEvent("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			stop();
		};
	}, [name]);
	useEffect(() => {
		if (report === null) {
			return;
		}
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: diagramTheme,
		});
		const nodes = document.querySelectorAll<HTMLElement>(".mermaid");
		if (nodes.length === 0) {
			return;
		}
		for (const node of nodes) {
			const definition = node.dataset.definition;
			if (definition !== undefined) {
				node.textContent = definition;
			}
			node.removeAttribute("data-processed");
		}
		let stopped = false;
		const bound: { drawn: SVGGElement; open: () => void }[] = [];
		const bind = () => {
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
						if (node.ticket === null) {
							continue;
						}
						const drawn = [...figure.querySelectorAll("g.node")].find((item) =>
							item.id.includes(`flowchart-${node.id}-`),
						);
						if (!(drawn instanceof SVGGElement)) {
							continue;
						}
						const ticket = node.ticket;
						const open = () => {
							openDrawnTicket({
								tracker: node.tracker,
								project: node.project,
								key: ticket,
							});
						};
						drawn.style.cursor = "pointer";
						drawn.addEventListener("click", open);
						bound.push({ drawn, open });
					}
				}
			}
		};
		void mermaid.run({ nodes }).then(bind);
		return () => {
			stopped = true;
			for (const { drawn, open } of bound) {
				drawn.removeEventListener("click", open);
			}
		};
	}, [diagramTheme, report]);
	useEffect(
		() =>
			watchPageTheme((theme) => {
				setDiagramTheme(theme === "dark" ? "dark" : "default");
			}),
		[],
	);
	if (missing) {
		return <PageFrame title={name}>Project not found</PageFrame>;
	}
	if (report === null) {
		return <PageFrame title={name}>Loading {name}</PageFrame>;
	}
	return (
		<Report
			report={report}
			ticket={ticket}
			onOpen={(key) => {
				openDrawnTicket({
					tracker: report.tracker,
					project: report.name,
					key,
				});
			}}
		/>
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
