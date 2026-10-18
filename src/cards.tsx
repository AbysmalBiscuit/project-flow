import { createRoot } from "react-dom/client";
import type { Overview } from "./domain.ts";

function Cards({ overview }: { overview: Overview }) {
	return (
		<main>
			<h1>Projects</h1>
			<ul>
				{overview.projects.map((project) => (
					<li key={project.name} className="card">
						<h2>{project.name}</h2>
						<p>Done {project.done}</p>
						<p>Dropped {project.dropped}</p>
						<p>Backlog {project.backlog}</p>
					</li>
				))}
			</ul>
		</main>
	);
}

const root = document.getElementById("root");
if (root !== null) {
	const response = await fetch("/api/overview");
	const overview = (await response.json()) as Overview;
	createRoot(root).render(<Cards overview={overview} />);
}
