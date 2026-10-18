import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CrossProjectBlocker, Overview } from "./domain.ts";

function projectPath(name: string, ticket: string): string {
	return `/projects/${encodeURIComponent(name)}?ticket=${encodeURIComponent(ticket)}`;
}

function openedLabel(): string | null {
	if (!window.location.pathname.startsWith("/projects/")) {
		return null;
	}
	const name = decodeURIComponent(
		window.location.pathname.slice("/projects/".length),
	);
	const ticket = new URLSearchParams(window.location.search).get("ticket");
	return ticket === null ? `Opened ${name}` : `Opened ${name} ${ticket}`;
}

function Chip({
	blocker,
	onOpen,
}: {
	blocker: CrossProjectBlocker;
	onOpen: (label: string) => void;
}) {
	const path = projectPath(blocker.project, blocker.key);
	const label = `Opened ${blocker.project} ${blocker.key}`;
	return (
		<a
			className="blocker-chip"
			href={path}
			onClick={(event) => {
				event.preventDefault();
				window.history.pushState({}, "", path);
				onOpen(label);
			}}
		>
			{blocker.project} {blocker.key}
		</a>
	);
}

function Cards({ overview }: { overview: Overview }) {
	const [opened, setOpened] = useState(openedLabel);
	useEffect(() => {
		const onPop = () => setOpened(openedLabel());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
	return (
		<main>
			<h1>Projects</h1>
			{overview.error !== null ? (
				<p className="stale">{overview.error}</p>
			) : null}
			{opened === null ? null : (
				<p className="opened">
					{opened}{" "}
					<button
						type="button"
						className="back"
						onClick={() => window.history.back()}
					>
						Back
					</button>
				</p>
			)}
			<ul>
				{overview.projects.map((project) => (
					<li
						key={`${project.tracker}:${project.name}`}
						className={
							opened === `Opened ${project.name}` ||
							opened?.startsWith(`Opened ${project.name} `) === true
								? "card highlighted"
								: "card"
						}
					>
						<h2>{project.name}</h2>
						<p className="counts">
							Done {project.done} Dropped {project.dropped} Blocked{" "}
							{project.blocked} Backlog {project.backlog} In progress{" "}
							{project.inProgress}
						</p>
						{project.crossProjectBlockers.length === 0 ? null : (
							<p className="blockers">
								{project.crossProjectBlockers.map((blocker) => (
									<Chip
										key={`${blocker.project} ${blocker.key}`}
										blocker={blocker}
										onOpen={setOpened}
									/>
								))}
							</p>
						)}
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

function Page() {
	const [overview, setOverview] = useState<Overview | null>(null);
	useEffect(() => {
		const events = new EventSource("/api/events");
		events.addEventListener("overview", (event) => {
			setOverview(JSON.parse(event.data) as Overview);
		});
		void readOverview().then(setOverview);
		return () => {
			events.close();
		};
	}, []);
	if (overview === null) {
		return null;
	}
	return <Cards overview={overview} />;
}

if (typeof document !== "undefined") {
	const root = document.getElementById("root");
	if (root !== null) {
		createRoot(root).render(<Page />);
	}
}
