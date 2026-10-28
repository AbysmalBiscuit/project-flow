import { attentionOf } from "./attention.ts";
import { type TicketGraph, ticketGraph } from "./blockers.ts";
import type { Configuration } from "./configuration.ts";
import { projectCounts } from "./counts.ts";
import type { Attention, FetchStatus, Overview, Snapshot } from "./domain.ts";
import { staleView } from "./poll-merge.ts";
import type { PollOptions } from "./poll.ts";
import type { Viewer } from "./ports.ts";
import {
	listedRef,
	pinRef,
	projectId,
	refPin,
	refRepo,
	sameProject,
} from "./project-ref.ts";
import { expectedBotsByRepo } from "./review.ts";
import { runList, type RunListRow } from "./run-list.ts";
import { pendingProjects } from "./settings-catalogue.ts";
import { commentNotificationId, needsYouSeenId } from "./ticket-key.ts";

export function seededForProjects(
	attention: Attention,
	projects: ReadonlySet<string>,
): string[] {
	const needsYou = attention.needsYou.flatMap((item) =>
		projects.has(item.project) ? [needsYouSeenId(item)] : [],
	);
	const comments = [...attention.comments.values()].flatMap((comment) =>
		projects.has(comment.project)
			? [commentNotificationId(comment, comment.stamp)]
			: [],
	);
	return [...needsYou, ...comments];
}

export function viewerLogins(
	configuration: Configuration,
	viewers: Viewer[],
): string[] {
	const found = viewers.flatMap((viewer) => {
		const names = viewer.login.trim() === "" ? [] : [viewer.login];
		return viewer.id === undefined || viewer.id.trim() === ""
			? names
			: [...names, viewer.id];
	});
	const override = configuration.viewerLogins.filter(
		(login) => login.trim() !== "",
	);
	return override.length === 0 ? found : [...override, ...found];
}

function needsYouRules(configuration: Configuration, viewers: Viewer[]) {
	return {
		pmBot: configuration.pmBot,
		labels: configuration.needsYouLabels,
		viewerLogins: viewerLogins(configuration, viewers),
	};
}

function trackedPin(
	row: Snapshot,
	tracked: Configuration["tracked"],
): Configuration["tracked"][number] | undefined {
	const ref = listedRef(row);
	return tracked.find((pin) => sameProject(ref, pinRef(pin)));
}

function trackedRows(options: PollOptions, configuration: Configuration) {
	const rows = options.store
		.readTickets()
		.filter((row) => trackedPin(row, configuration.tracked) !== undefined);
	const all = rows.map((row) => {
		const repo = refRepo(listedRef(row));
		return { project: repo ?? row.name, repo, tickets: row.tickets };
	});
	return { rows, all };
}

function projectStatus(options: PollOptions, row: Snapshot): FetchStatus {
	const ref = listedRef(row);
	return {
		fetchedAt: options.store.lastGoodPollAt(ref)?.toISOString() ?? null,
		error: options.store.projectError(ref),
	};
}

function computeProjectView(
	row: Snapshot,
	graph: TicketGraph,
	status: FetchStatus,
	options: PollOptions,
	configuration: Configuration,
) {
	const counted = projectCounts(
		row.name,
		row.key,
		row.tracker,
		row.tickets,
		row.pulls,
		row.branches,
		row.startedKeys,
		options.runs,
		options.factoryRuns().filter((run) => run.archivedAt === undefined),
		{
			config: configuration.autoMerge,
			workcell: options.workcellAuto,
			repo: options.repoAutoMerge,
		},
		graph,
		expectedBotsByRepo(row.pulls, configuration.expectedBots ?? {}),
		status,
		needsYouRules(configuration, options.viewers),
		configuration,
		new Date(status.fetchedAt ?? 0),
		row.board,
	);
	return {
		row,
		items: counted.needsYou,
		counts: {
			...counted.counts,
			ref: trackedPin(row, configuration.tracked) ?? refPin(listedRef(row)),
		},
		report: counted.report,
	};
}

type ProjectView = ReturnType<typeof computeProjectView>;

type ViewInputs = readonly [rows: Snapshot[], sources: string];

function freshViews(
	options: PollOptions,
	configuration: Configuration,
	inputs: ViewInputs,
) {
	const tracked = trackedRows(options, configuration);
	return {
		inputs,
		tracked,
		graph: ticketGraph(tracked.all),
		views: new Map<Snapshot, { status: FetchStatus; view: ProjectView }>(),
	};
}

const computed = new WeakMap<
	PollOptions["store"],
	ReturnType<typeof freshViews>
>();

function viewInputs(
	options: PollOptions,
	configuration: Configuration,
): ViewInputs {
	return [
		options.store.readTickets(),
		// The poll reads the configuration file again, so equal values can
		// arrive as two objects.
		JSON.stringify([
			configuration,
			options.runs,
			options.factoryRuns(),
			options.viewers,
			options.workcellAuto,
			options.repoAutoMerge,
		]),
	];
}

/**
 * The views computed since the last input change. Each view is computed on
 * first use, and again when the poll status of its project changes.
 */
function cachedViews(options: PollOptions, configuration: Configuration) {
	const inputs = viewInputs(options, configuration);
	const last = computed.get(options.store);
	const entry =
		last !== undefined &&
		inputs.every((input, index) => input === last.inputs[index])
			? last
			: freshViews(options, configuration, inputs);
	computed.set(options.store, entry);
	const viewOf = (row: Snapshot): ProjectView => {
		const status = projectStatus(options, row);
		const known = entry.views.get(row);
		if (
			known !== undefined &&
			known.status.fetchedAt === status.fetchedAt &&
			known.status.error === status.error
		) {
			return known.view;
		}
		const view = computeProjectView(
			row,
			entry.graph,
			status,
			options,
			configuration,
		);
		entry.views.set(row, { status, view });
		return view;
	};
	return { rows: entry.tracked.rows, viewOf };
}

/** The views of every tracked project, computed again only when an input changes. */
export function projectViews(
	options: PollOptions,
	configuration: Configuration,
): ProjectView[] {
	const { rows, viewOf } = cachedViews(options, configuration);
	return rows.map(viewOf);
}

/**
 * The view of one tracked project, plus the views of the projects its graph
 * links reach, which give the state of each linked ticket.
 */
export function projectViewNamed(
	options: PollOptions,
	configuration: Configuration,
	name: string,
): { view: ProjectView; linked: ProjectView[] } | null {
	const { rows, viewOf } = cachedViews(options, configuration);
	const named = (wanted: string) =>
		rows.find((row) => row.name.toLowerCase() === wanted.toLowerCase());
	const row = named(name);
	if (row === undefined) {
		return null;
	}
	const view = viewOf(row);
	const reached = new Set(
		view.report.graphLinks.flatMap((link) =>
			[link.from, link.to].flatMap((end) =>
				end.state === undefined ? [end.project.toLowerCase()] : [],
			),
		),
	);
	reached.delete(row.name.toLowerCase());
	const linked = [...reached].flatMap((project) => {
		const other = named(project);
		return other === undefined ? [] : [viewOf(other)];
	});
	return { view, linked };
}

/** Every run that the factories report, newest first, with its ticket from the tracked projects. */
export function factoryRunList(
	options: PollOptions,
	configuration: Configuration,
): RunListRow[] {
	return runList(
		options.factoryRuns(),
		trackedRows(options, configuration).rows,
	);
}

export function attentionFor(
	options: PollOptions,
	configuration: Configuration,
): Attention {
	return attentionOf(projectViews(options, configuration), configuration.pmBot);
}

export function overview(
	options: PollOptions,
	configuration: Configuration,
): Overview {
	const counted = projectViews(options, configuration).map(
		(item) => item.counts,
	);
	const pending = options.polling
		? pendingProjects(
				options.catalogue,
				configuration.tracked,
				counted,
				new Set(
					options.catalogue.flatMap((project) => {
						const ref = listedRef(project);
						return options.store.lastGoodPollAt(ref) === null
							? []
							: [projectId(ref)];
					}),
				),
			)
		: [];
	const projects = [...counted, ...pending];
	const goodPolls = projects.flatMap((project) => {
		const at = options.store.lastGoodPollAt(pinRef(project.ref));
		return at === null ? [] : [at.toISOString()];
	});
	return {
		projects,
		...staleView(
			options.store.fetchStatus(),
			goodPolls.length === 0 ? null : (goodPolls.sort()[0] ?? null),
		),
		...(configuration.tracked.length === 0 ? { tracked: false as const } : {}),
		...(options.factoryUnreachable()
			? { factoryUnreachable: true as const }
			: {}),
	};
}
