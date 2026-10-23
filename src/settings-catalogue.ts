import type { Configuration, ProjectPin } from "./configuration.ts";
import type {
	ProjectCounts,
	SettingsProject,
	SettingsSnapshot,
} from "./domain.ts";
import { expectedBotsByRepo, projectHasPmBot } from "./domain.ts";
import type { KnownBot } from "./known-bots.ts";
import { knownBots } from "./known-bots.ts";
import { emptyStatusTypes } from "./lanes.ts";
import {
	listedRef,
	pinRef,
	projectId,
	refListed,
	refPin,
	refRepo,
	repoKey,
	repoParts,
	samePin,
	sameProject,
} from "./project-ref.ts";

export type CatalogueProject = {
	key: string;
	name?: string;
	tracker: "github" | "linear";
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

export function reposFor(
	project: CatalogueProject,
	snapshots: readonly SettingsSnapshot[],
): string[] {
	const ref = listedRef(project);
	const row = snapshots.find((item) => sameProject(listedRef(item), ref));
	if (row !== undefined && row.pulls.length > 0) {
		return [...new Set(row.pulls.map((pull) => pull.repo).filter(Boolean))];
	}
	const repo = refRepo(ref);
	return repo === null ? [] : [repo];
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
): SettingsSnapshot["pulls"] {
	return snapshots.flatMap((item) =>
		item.pulls.filter((pull) => repos.includes(pull.repo)),
	);
}

function catalogueRow(
	project: CatalogueProject,
	configuration: Configuration,
	snapshots: readonly SettingsSnapshot[],
	source: SettingsProject["source"],
	ref: ProjectPin,
): SettingsProject {
	const repos = reposFor(project, snapshots);
	const bots = botsFor(
		repos,
		configuration.expectedBots,
		pullsFor(repos, snapshots),
	);
	return {
		name: displayName(project),
		key: project.key,
		tracker: project.tracker,
		source,
		tracked: configuration.tracked.some((item) => matchesRef(project, item)),
		pmBot: projectHasPmBot(configuration.pmBot, project.key, project.tracker),
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
				repos.add(pull.repo);
			}
		}
	}
	return repos;
}
