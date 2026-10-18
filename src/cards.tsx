import { createRoot } from "react-dom/client";
import type { Overview } from "./domain.ts";

function Cards({ overview }: { overview: Overview }) {
	return (
		<main>
			<h1>Projects</h1>
			<ul>
				{overview.projects.map((project) => (
					<li key={`${project.tracker}:${project.name}`} className="card">
						<h2>{project.name}</h2>
						<p className="counts">
							Done {project.done} Dropped {project.dropped} Backlog{" "}
							{project.backlog} In progress {project.inProgress}
						</p>
					</li>
				))}
			</ul>
		</main>
	);
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
	if (root !== null) {
		const overview = await readOverview();
		createRoot(root).render(<Cards overview={overview} />);
	}
}
