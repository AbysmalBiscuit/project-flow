import type { Configuration, ProjectPin } from "./configuration.ts";
import type {
	ProjectCounts,
	SettingsProject,
	SettingsSnapshot,
	TrackerKind,
} from "./domain.ts";
import type { KnownBot } from "./known-bots.ts";
import { knownBots } from "./known-bots.ts";
import { emptyStatusTypes } from "./lanes.ts";
import { projectHasPmBot } from "./open-ask.ts";
import {
	listedRef,
	pinRef,
	projectId,
	refHost,
	refListed,
	refPin,
	refRepo,
	repoKey,
	repoParts,
	samePin,
	sameProject,
	settingsKey,
} from "./project-ref.ts";
import { expectedBotsByRepo } from "./review.ts";

export type CatalogueProject = {
	key: string;
	name?: string;
	tracker: TrackerKind;
	host?: string;
	owner?: string;
	number?: number;
	configuredOnly?: boolean;
};

export function matchesRef(
	project: CatalogueProject,
	ref: ProjectPin,
): boolean {
	return sameProject(listedRef(project), pinRef(ref));
}

export function refForFound(
	project: CatalogueProject,
	tracked: readonly ProjectPin[],
): ProjectPin {
	return (
		tracked.find((ref) => matchesRef(project, ref)) ??
		refPin(listedRef(project))
	);
}

export function displayName(project: CatalogueProject): string {
	if (project.name !== undefined && project.name !== project.key) {
		return project.name;
	}
	const repo = refRepo(listedRef(project));
	return (repo === null ? null : repoParts(repo)?.name) ?? project.key;
}

function pendingCard(
	project: CatalogueProject,
	tracked: readonly ProjectPin[],
): ProjectCounts {
	return {
		name: project.name ?? project.key,
		tracker: project.tracker,
		ref: refForFound(project, tracked),
		done: 0,
		dropped: 0,
		blocked: 0,
		backlog: 0,
		inProgress: 0,
		inReview: 0,
		awaitingMerge: 0,
		unlinkedPrs: [],
		tickets: [],
		crossProjectBlockers: [],
		needsYou: 0,
		progress: 0,
		fetchedAt: null,
		error: null,
		tags: [],
		statusTypes: emptyStatusTypes(),
		pending: true,
	};
}

/** Tracked projects with no stored read, shown while a poll is running. */
export function pendingProjects(
	catalogue: readonly CatalogueProject[],
	tracked: readonly ProjectPin[],
	counted: readonly ProjectCounts[],
	polledIds: ReadonlySet<string>,
): ProjectCounts[] {
	return catalogue.flatMap((project) => {
		const pin = tracked.find((ref) => matchesRef(project, ref));
		if (pin === undefined || polledIds.has(projectId(listedRef(project)))) {
			return [];
		}
		if (counted.some((item) => samePin(item.ref, pin))) {
			return [];
		}
		return [pendingCard(project, tracked)];
	});
}

type SettingsPull = SettingsSnapshot["pulls"][number];

/** The `settingsKey` of the repo of a PR, on the host of the PR, as the review rules key it. */
function pullRepoKey(pull: SettingsPull): string {
	return settingsKey(pull.repo, pull.host);
}

/** The `settingsKey` of each repo of a project. */
export function reposFor(
	project: CatalogueProject,
	snapshots: readonly SettingsSnapshot[],
): string[] {
	const ref = listedRef(project);
	const row = snapshots.find((item) => sameProject(listedRef(item), ref));
	const pulls = row?.pulls.filter((pull) => pull.repo !== "") ?? [];
	if (pulls.length > 0) {
		return [...new Set(pulls.map(pullRepoKey))];
	}
	const repo = refRepo(ref);
	return repo === null ? [] : [settingsKey(repo, refHost(ref))];
}

export function botsFor(
	repos: readonly string[],
	expectedBots: Configuration["expectedBots"],
	pulls: Parameters<typeof expectedBotsByRepo>[0],
): { expectedBots: KnownBot[]; repoBots: Record<string, KnownBot[]> } {
	const overrides = expectedBots ?? {};
	const inferred = expectedBotsByRepo(pulls, {});
	const repoBots: Record<string, KnownBot[]> = {};
	for (const repo of repos) {
		const saved = repoKey(overrides, repo);
		const source =
			saved === undefined
				? (inferred.get(repo) ?? [])
				: (overrides[saved] ?? []);
		repoBots[repo] = knownBots.filter((bot) => source.includes(bot));
	}
	const found = Object.values(repoBots).flat();
	return {
		expectedBots: knownBots.filter((bot) => found.includes(bot)),
		repoBots,
	};
}

function pullsFor(
	repos: readonly string[],
	snapshots: readonly SettingsSnapshot[],
): SettingsPull[] {
	return snapshots.flatMap((item) =>
		item.pulls.filter((pull) => repos.includes(pullRepoKey(pull))),
	);
}

function catalogueRow(
	project: CatalogueProject,
	configuration: Configuration,
	snapshots: readonly SettingsSnapshot[],
	source: SettingsProject["source"],
	ref: ProjectPin,
): SettingsProject {
	const key = settingsKey(project.key, refHost(listedRef(project)));
	const repos = reposFor(project, snapshots);
	const bots = botsFor(
		repos,
		configuration.expectedBots,
		pullsFor(repos, snapshots),
	);
	return {
		name: displayName(project),
		key,
		tracker: project.tracker,
		source,
		tracked: configuration.tracked.some((item) => matchesRef(project, item)),
		pmBot: projectHasPmBot(configuration.pmBot, key, project.tracker),
		repos,
		expectedBots: bots.expectedBots,
		repoBots: bots.repoBots,
		ref,
	};
}

export function settingsProjects(
	configuration: Configuration,
	catalogue: readonly CatalogueProject[],
	snapshots: readonly SettingsSnapshot[],
): SettingsProject[] {
	const rows = catalogue.map((project) =>
		catalogueRow(
			project,
			configuration,
			snapshots,
			project.configuredOnly === true ? "configured" : "found",
			refForFound(project, configuration.tracked),
		),
	);
	for (const pin of configuration.tracked) {
		const located = catalogue.find((project) => matchesRef(project, pin));
		if (located !== undefined) {
			continue;
		}
		rows.push({
			...catalogueRow(
				refListed(pinRef(pin)),
				configuration,
				snapshots,
				"configured",
				pin,
			),
			tracked: true,
		});
	}
	rows.sort((left, right) => left.name.localeCompare(right.name));
	return rows;
}

export function knownRepos(
	snapshots: readonly SettingsSnapshot[],
	catalogue: readonly CatalogueProject[],
): Set<string> {
	const repos = new Set<string>();
	for (const project of catalogue) {
		for (const repo of reposFor(project, snapshots)) {
			repos.add(repo);
		}
	}
	for (const row of snapshots) {
		for (const pull of row.pulls) {
			if (pull.repo !== "") {
				repos.add(pullRepoKey(pull));
			}
		}
	}
	return repos;
}
