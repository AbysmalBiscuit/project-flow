import type { Configuration } from "./configuration.ts";
import type { Overview, Snapshot } from "./domain.ts";
import {
	type Attention,
	attentionOf,
	expectedBotsByRepo,
	needsYouSeenId,
	projectCounts,
	staleView,
} from "./domain.ts";
import type { PollOptions } from "./poll.ts";
import type { Viewer } from "./ports.ts";
import { pendingProjects, refKey } from "./settings-catalogue.ts";
import { statusColours } from "./token-palette.ts";

export function seededForProjects(
	attention: Attention,
	projects: ReadonlySet<string>,
): string[] {
	const needsYou = attention.needsYou.flatMap((item) =>
		projects.has(item.project) ? [needsYouSeenId(item)] : [],
	);
	const comments = [...attention.comments].flatMap(([id, comment]) =>
		projects.has(comment.project) ? [`comment\n${id}\n${comment.stamp}`] : [],
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

function boardPin(
	row: Snapshot,
): Extract<Configuration["tracked"][number], { owner: string }> | null {
	const [laneOwner, numberText] = row.board?.laneKey?.split("/") ?? [];
	const laneNumber = Number(numberText);
	const owner = row.owner ?? laneOwner;
	const number = row.number ?? laneNumber;
	if (
		row.tracker !== "github" ||
		owner === undefined ||
		owner === "" ||
		!Number.isInteger(number) ||
		number <= 0
	) {
		return null;
	}
	return { tracker: "github", owner, project: number };
}

function sameProjectRef(
	row: Snapshot,
	ref: Configuration["tracked"][number],
): boolean {
	if (refKey(ref) === row.key) {
		return true;
	}
	const board = boardPin(row);
	return (
		board !== null &&
		ref.tracker === "github" &&
		"owner" in ref &&
		ref.owner === board.owner &&
		ref.project === board.project
	);
}

function projectRef(
	row: Snapshot,
	tracked: Configuration["tracked"],
): Configuration["tracked"][number] {
	const pin = tracked.find((ref) => sameProjectRef(row, ref));
	if (pin !== undefined) {
		return pin;
	}
	const board = boardPin(row);
	if (board !== null) {
		return board;
	}
	if (row.tracker === "linear") {
		return { tracker: "linear", project: row.key };
	}
	return { tracker: "github", repo: row.key };
}

function trackedRows(options: PollOptions, configuration: Configuration) {
	const rows = options.store
		.readTickets()
		.filter((row) =>
			configuration.tracked.some((ref) => sameProjectRef(row, ref)),
		);
	const all = rows.map((row) => ({
		project: row.key.includes("/") ? row.key : row.name,
		tickets: row.tickets,
	}));
	return { rows, all };
}

type TrackedRows = ReturnType<typeof trackedRows>;

function computeProjectView(
	row: Snapshot,
	all: TrackedRows["all"],
	options: PollOptions,
	configuration: Configuration,
) {
	const goodPoll = options.store.lastGoodPollAt(row.key);
	const viewedAt = goodPoll ?? new Date(0);
	const counted = projectCounts(
		row.name,
		row.key,
		row.tracker,
		row.tickets,
		row.pulls,
		row.branches,
		row.startedKeys,
		options.runs,
		{
			config: configuration.autoMerge,
			workcell: options.workcellAuto,
			repo: options.repoAutoMerge,
		},
		all,
		expectedBotsByRepo(row.pulls, configuration.expectedBots ?? {}),
		{
			fetchedAt: goodPoll?.toISOString() ?? null,
			error: options.store.projectError(row.key),
		},
		needsYouRules(configuration, options.viewers),
		configuration.laneMappings,
		viewedAt,
		statusColours,
		row.board,
	);
	return {
		row,
		items: counted.needsYou,
		counts: {
			...counted.counts,
			ref: projectRef(row, configuration.tracked),
		},
		report: counted.report,
	};
}

type ProjectView = ReturnType<typeof computeProjectView>;

type ViewInputs = readonly [
	revision: number,
	configuration: Configuration,
	sources: string,
];

const computed = new WeakMap<
	PollOptions["store"],
	{
		inputs: ViewInputs;
		tracked: TrackedRows;
		views: Map<Snapshot, ProjectView>;
	}
>();

function viewInputs(
	options: PollOptions,
	configuration: Configuration,
): ViewInputs {
	return [
		options.store.revision(),
		configuration,
		JSON.stringify([
			options.runs,
			options.viewers,
			options.workcellAuto,
			options.repoAutoMerge,
		]),
	];
}

/** The views computed since the last input change; each view is computed on first use. */
function cachedViews(options: PollOptions, configuration: Configuration) {
	const inputs = viewInputs(options, configuration);
	const last = computed.get(options.store);
	const entry =
		last !== undefined &&
		inputs.every((input, index) => input === last.inputs[index])
			? last
			: {
					inputs,
					tracked: trackedRows(options, configuration),
					views: new Map<Snapshot, ProjectView>(),
				};
	computed.set(options.store, entry);
	const viewOf = (row: Snapshot): ProjectView => {
		const known = entry.views.get(row);
		if (known !== undefined) {
			return known;
		}
		const view = computeProjectView(
			row,
			entry.tracked.all,
			options,
			configuration,
		);
		entry.views.set(row, view);
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
					options.catalogue.flatMap((project) =>
						options.store.lastGoodPollAt(project.key) === null
							? []
							: [project.key],
					),
				),
			)
		: [];
	const projects = [...counted, ...pending];
	const goodPolls = projects.flatMap((project) => {
		const at = options.store.lastGoodPollAt(project.name);
		return at === null ? [] : [at.toISOString()];
	});
	return {
		projects,
		...staleView(
			options.store.fetchStatus(),
			goodPolls.length === 0 ? null : (goodPolls.sort()[0] ?? null),
		),
		...(configuration.tracked.length === 0 ? { tracked: false as const } : {}),
	};
}
