import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { Overview } from "./domain.ts";

function Cards({ overview }: { overview: Overview }) {
	return (
		<main>
			<h1>Projects</h1>
			<ul>
				{overview.projects.map((project) => (
					<li key={project.name} className="card">
						<h2>{project.name}</h2>
						<p className="counts">
							Done {project.done} Dropped {project.dropped} Backlog{" "}
							{project.backlog}
						</p>
					</li>
				))}
			</ul>
		</main>
	);
}

export function renderCards(overview: Overview): string {
	return renderToStaticMarkup(<Cards overview={overview} />);
}

async function readOverview(): Promise<Overview> {
	const response = await fetch("/api/overview");
	if (!response.ok) {
		throw new Error(`overview failed (HTTP ${response.status})`);
	}
	return (await response.json()) as Overview;
}

if (typeof document !== "undefined") {
	const root = document.getElementById("root");
	if (root !== null && root.childElementCount === 0) {
		const overview = await readOverview();
		createRoot(root).render(<Cards overview={overview} />);
	}
}
