import type { Configuration } from "./configuration.ts";
import type { ProjectReport } from "./domain.ts";
import { attachGraphStates } from "./links.ts";
import { type PollOptions, pollProject } from "./poll.ts";
import { listedRef, refListed, sameProject } from "./project-ref.ts";
import { projectViewNamed, projectViews } from "./project-views.ts";
import { filterProjectReport, projectViewFor } from "./report.ts";
import { routeTable } from "./route-table.ts";
import { searchTickets } from "./search.ts";

export function reportFor(
	options: PollOptions,
	configuration: Configuration,
	name: string,
	filtered: boolean,
): ProjectReport | null {
	const found = projectViewNamed(options, configuration, name);
	if (found === null) {
		return null;
	}
	const [match] = attachGraphStates([
		found.view.report,
		...found.linked.map((item) => item.report),
	]);
	if (match === undefined) {
		return null;
	}
	const view = projectViewFor(configuration, match.name);
	return filtered
		? filterProjectReport(match, view, options.clock.now())
		: match;
}

/** The routes that read the tickets of the tracked projects, and refresh one project. */
export function projectRoutes(
	pollOptions: PollOptions,
	configuration: () => Configuration,
) {
	return routeTable({
		"/api/needs-you": {
			GET: () =>
				Response.json(
					projectViews(pollOptions, configuration()).flatMap(
						(item) => item.items,
					),
				),
		},
		"/api/search": {
			GET: (request: Request) => {
				const query = new URL(request.url).searchParams.get("q") ?? "";
				return Response.json(
					searchTickets(projectViews(pollOptions, configuration()), query),
				);
			},
		},
		"/api/projects/:name": {
			GET: (request) => {
				const name = request.params.name;
				const filtered =
					new URL(request.url).searchParams.get("view") !== "all";
				const report = reportFor(pollOptions, configuration(), name, filtered);
				if (report === null) {
					return Response.json({ error: "project not found" }, { status: 404 });
				}
				return Response.json(report);
			},
		},
		"/api/projects/:name/refresh": {
			POST: async (request) => {
				const name = request.params.name.toLowerCase();
				const row = pollOptions.store
					.readTickets()
					.find((item) => item.name.toLowerCase() === name);
				if (row === undefined) {
					return Response.json({ error: "project not found" }, { status: 404 });
				}
				const ref = listedRef(row);
				const found = pollOptions.catalogue.find((item) =>
					sameProject(listedRef(item), ref),
				);
				await pollProject(pollOptions, configuration(), {
					...(found ?? {
						...refListed(ref),
						name: row.name,
						updatedAt: null,
					}),
					ref,
				});
				return new Response(null, { status: 204 });
			},
		},
	});
}
