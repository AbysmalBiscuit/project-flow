import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Diagram, ProjectReport, TicketView } from "./domain.ts";

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

function TicketLine({
	ticket,
	highlight,
}: {
	ticket: TicketView;
	highlight: string | null;
}) {
	const marked = highlight !== null && highlight === ticket.key;
	return (
		<li
			className={marked ? "ticket highlighted" : "ticket"}
			data-ticket={ticket.key ?? ""}
		>
			{ticket.key} {ticket.title} {ticket.state}
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
						window.history.pushState(
							{},
							"",
							openPath(node.project, node.ticket),
						);
						window.dispatchEvent(new PopStateEvent("popstate"));
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
			<pre className="mermaid">{diagram.definition}</pre>
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
}: {
	report: ProjectReport;
	ticket: string | null;
}) {
	return (
		<main className="project-page" data-project={report.name}>
			<p>
				<a className="back" href="/">
					Projects
				</a>
			</p>
			<h1>{report.name}</h1>
			{report.sections.map((section) => (
				<section key={section.id} className="report-section" id={section.id}>
					<h2>{section.title}</h2>
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
								/>
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
	const [report, setReport] = useState<ProjectReport | null>(null);
	const [missing, setMissing] = useState(false);
	useEffect(() => {
		const onPop = () => {
			setName(projectName());
			setTicket(highlightKey());
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
	useEffect(() => {
		const path = openPath(name, ticket);
		let stopped = false;
		setMissing(false);
		fetch(`/api${path}`)
			.then(async (response) => {
				if (stopped) {
					return;
				}
				if (!response.ok) {
					setReport(null);
					setMissing(true);
					return;
				}
				setReport((await response.json()) as ProjectReport);
			})
			.catch(() => {
				if (!stopped) {
					setReport(null);
					setMissing(true);
				}
			});
		return () => {
			stopped = true;
		};
	}, [name, ticket]);
	useEffect(() => {
		if (report === null) {
			return;
		}
		mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
		const nodes = document.querySelectorAll<HTMLElement>(".mermaid");
		if (nodes.length > 0) {
			void mermaid.run({ nodes });
		}
	}, [report]);
	if (missing) {
		return <main>Project not found</main>;
	}
	if (report === null) {
		return <main>Loading {name}</main>;
	}
	return <Report report={report} ticket={ticket} />;
}

async function mount(): Promise<void> {
	const root = document.getElementById("root");
	if (root === null) {
		return;
	}
	createRoot(root).render(<Page />);
}

if (typeof document !== "undefined") {
	await mount();
}
