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

export function projectViews(
	options: PollOptions,
	configuration: Configuration,
) {
	const rows = options.store
		.readTickets()
		.filter((row) =>
			configuration.tracked.some((ref) => sameProjectRef(row, ref)),
		);
	const all = rows.map((row) => ({
		project: row.key.includes("/") ? row.key : row.name,
		tickets: row.tickets,
	}));
	return rows.map((row) => {
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
	});
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
