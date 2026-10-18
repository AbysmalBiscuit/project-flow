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

async function readOverview(): Promise<Overview> {
	for (;;) {
		const response = await fetch("/api/overview");
		const overview = (await response.json()) as Overview;
		if (overview.projects.length > 0) {
			return overview;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

const root = document.getElementById("root");
if (root !== null) {
	const overview = await readOverview();
	createRoot(root).render(<Cards overview={overview} />);
}
