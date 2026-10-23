import type { ProjectPin } from "./configuration.ts";
import type { Tracker } from "./domain.ts";

// GitHub owner and repo names compare without case. Linear keys compare as
// they are.

/**
 * The identity of a project. The key of a GitHub project is `owner/number`,
 * the key that lane mappings use. Read the kind, never the shape of the key.
 */
export type ProjectRef =
	| { kind: "linear-project"; tracker: "linear"; key: string }
	| { kind: "github-repo"; tracker: "github"; key: string }
	| {
			kind: "github-project";
			tracker: "github";
			key: string;
			owner: string;
			number: number;
	  };

/** The `owner/name` form of a GitHub repo. */
export const ownerRepo = /^[^/\s]+\/[^/\s]+$/;

/** The owner and name of a GitHub repo, or null when the text names no repo. */
export function repoParts(
	repo: string,
): { owner: string; name: string } | null {
	const [owner, name] = repo.split("/");
	if (owner === undefined || name === undefined || name === "") {
		return null;
	}
	return { owner, name };
}

/** A project as a tracker lists it: a GitHub project carries its owner and number. */
export type ListedRef = {
	key: string;
	tracker: Tracker;
	owner?: string;
	number?: number;
};

function githubProject(owner: string, number: number): ProjectRef {
	return {
		kind: "github-project",
		tracker: "github",
		key: `${owner}/${number}`,
		owner,
		number,
	};
}

/** The ProjectRef of a tracked entry in the configuration. */
export function pinRef(pin: ProjectPin): ProjectRef {
	if (pin.tracker === "linear") {
		return { kind: "linear-project", tracker: "linear", key: pin.project };
	}
	if ("repo" in pin) {
		return { kind: "github-repo", tracker: "github", key: pin.repo };
	}
	return githubProject(pin.owner, pin.project);
}

/** The ProjectRef of a project that a tracker lists. */
export function listedRef(project: ListedRef): ProjectRef {
	if (project.tracker === "linear") {
		return { kind: "linear-project", tracker: "linear", key: project.key };
	}
	if (project.owner !== undefined && project.number !== undefined) {
		return githubProject(project.owner, project.number);
	}
	return { kind: "github-repo", tracker: "github", key: project.key };
}

/** The listed form of a ProjectRef, for a project that no tracker listed. */
export function refListed(ref: ProjectRef): ListedRef {
	return ref.kind === "github-project"
		? {
				key: ref.key,
				tracker: ref.tracker,
				owner: ref.owner,
				number: ref.number,
			}
		: { key: ref.key, tracker: ref.tracker };
}

/** The configuration form of a ProjectRef. */
export function refPin(ref: ProjectRef): ProjectPin {
	switch (ref.kind) {
		case "linear-project":
			return { tracker: "linear", project: ref.key };
		case "github-repo":
			return { tracker: "github", repo: ref.key };
		case "github-project":
			return { tracker: "github", owner: ref.owner, project: ref.number };
	}
}

/** The repo of a GitHub repo project, or null for any other kind. */
export function refRepo(ref: ProjectRef): string | null {
	return ref.kind === "github-repo" ? ref.key : null;
}

function foldGithub(name: string): string {
	return name.toLowerCase();
}

export function sameRepo(left: string, right: string): boolean {
	return foldGithub(left) === foldGithub(right);
}

/** The key that a record keeps for a repo, whatever its case. */
export function repoKey(
	record: Readonly<Record<string, unknown>>,
	repo: string,
): string | undefined {
	return Object.keys(record).find((key) => sameRepo(key, repo));
}

/** A string that two ProjectRefs share when they name the same project. */
export function projectId(ref: ProjectRef): string {
	const key = ref.tracker === "github" ? foldGithub(ref.key) : ref.key;
	return `${ref.kind}:${key}`;
}

export function sameProject(left: ProjectRef, right: ProjectRef): boolean {
	return projectId(left) === projectId(right);
}

export function samePin(left: ProjectPin, right: ProjectPin): boolean {
	return sameProject(pinRef(left), pinRef(right));
}
