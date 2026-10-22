import type { Configuration, ProjectPin } from "./configuration.ts";
import type {
	ProjectCounts,
	SettingsProject,
	SettingsSnapshot,
} from "./domain.ts";
import {
	emptyStatusTypes,
	expectedBotsByRepo,
	projectHasPmBot,
	samePin,
} from "./domain.ts";
import type { KnownBot } from "./known-bots.ts";
import { knownBots } from "./known-bots.ts";

export type CatalogueProject = {
	key: string;
	name?: string;
	tracker: "github" | "linear";
	owner?: string;
	number?: number;
	configuredOnly?: boolean;
};

export function refKey(ref: ProjectPin): string {
	if (ref.tracker === "linear") {
		return ref.project;
	}
	if ("repo" in ref) {
		return ref.repo;
	}
	return `${ref.owner}/${ref.project}`;
}

export function matchesRef(
	project: CatalogueProject,
	ref: ProjectPin,
): boolean {
	if (project.tracker !== ref.tracker) {
		return false;
	}
	if (ref.tracker === "linear") {
		return project.key === ref.project;
	}
	if ("repo" in ref) {
		return project.key === ref.repo;
	}
	return project.owner === ref.owner && project.number === ref.project;
}

export function refForFound(
	project: CatalogueProject,
	tracked: readonly ProjectPin[],
): ProjectPin {
	const pin = tracked.find((ref) => matchesRef(project, ref));
	if (pin !== undefined) {
		return pin;
	}
	if (project.tracker === "linear") {
		return { tracker: "linear", project: project.key };
	}
	if (
		project.owner !== undefined &&
		project.number !== undefined &&
		!project.key.includes("/")
	) {
		return {
			tracker: "github",
			owner: project.owner,
			project: project.number,
		};
	}
	return { tracker: "github", repo: project.key };
}

export function displayName(project: CatalogueProject): string {
	if (project.name !== undefined && project.name !== project.key) {
		return project.name;
	}
	const slash = project.key.lastIndexOf("/");
	return slash === -1 ? project.key : project.key.slice(slash + 1);
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
	polledKeys: ReadonlySet<string>,
): ProjectCounts[] {
	return catalogue.flatMap((project) => {
		const pin = tracked.find((ref) => matchesRef(project, ref));
		if (pin === undefined || polledKeys.has(project.key)) {
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
	snapshots: readonly { key: string; pulls: { repo: string }[] }[],
	expectedBots: Configuration["expectedBots"],
): string[] {
	const row = snapshots.find((item) => item.key === project.key);
	if (row !== undefined && row.pulls.length > 0) {
		return [...new Set(row.pulls.map((pull) => pull.repo).filter(Boolean))];
	}
	if (
		project.tracker === "github" &&
		project.owner === undefined &&
		project.number === undefined &&
		project.key.includes("/")
	) {
		return [project.key];
	}
	const saved = expectedBots ?? {};
	return Object.keys(saved).filter(
		(repo) => repo.toLowerCase() === project.key.toLowerCase(),
	);
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
		const source = Object.hasOwn(overrides, repo)
			? (overrides[repo] ?? [])
			: (inferred.get(repo) ?? []);
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

function absentProject(
	key: string,
	tracker: ProjectPin["tracker"],
): CatalogueProject {
	return { key, tracker };
}

function catalogueRow(
	project: CatalogueProject,
	configuration: Configuration,
	snapshots: readonly SettingsSnapshot[],
	source: SettingsProject["source"],
	ref: ProjectPin,
): SettingsProject {
	const repos = reposFor(project, snapshots, configuration.expectedBots);
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
		if (located !== undefined && rows.some((row) => row.key === located.key)) {
			continue;
		}
		const key = located?.key ?? refKey(pin);
		const absent = located ?? absentProject(key, pin.tracker);
		rows.push({
			...catalogueRow(absent, configuration, snapshots, "configured", pin),
			key,
			tracker: pin.tracker,
			tracked: true,
		});
	}
	rows.sort((left, right) => left.name.localeCompare(right.name));
	return rows;
}

export function knownRepos(
	snapshots: readonly { key: string; pulls: { repo: string }[] }[],
	catalogue: readonly CatalogueProject[],
): Set<string> {
	const repos = new Set<string>();
	for (const project of catalogue) {
		for (const repo of reposFor(project, snapshots, undefined)) {
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
