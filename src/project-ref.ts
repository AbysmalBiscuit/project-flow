import type { ProjectPin } from "./configuration.ts";
import type { TrackerKind } from "./domain.ts";

// GitHub owner and repo names compare without case. Linear keys compare as
// they are.

/**
 * The identity of a project. The key of a GitHub project is `owner/number`,
 * the key that lane mappings use. Read the kind, never the shape of the key.
 */
export type ProjectRef =
	| { kind: "linear-project"; tracker: "linear"; key: string }
	| { kind: "github-repo"; tracker: "github"; key: string; host?: string }
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
	tracker: TrackerKind;
	name?: string;
	host?: string;
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

function githubRepo(key: string, host: string | undefined): ProjectRef {
	return {
		kind: "github-repo",
		tracker: "github",
		key,
		...(host === undefined ? {} : { host }),
	};
}

/** The ProjectRef of a tracked entry in the configuration. */
export function pinRef(pin: ProjectPin): ProjectRef {
	if (pin.tracker === "linear") {
		return { kind: "linear-project", tracker: "linear", key: pin.project };
	}
	if ("repo" in pin) {
		return githubRepo(pin.repo, "host" in pin ? pin.host : undefined);
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
	return githubRepo(project.key, project.host);
}

/** The listed form of a ProjectRef, for a project that no tracker listed. */
export function refListed(ref: ProjectRef): ListedRef {
	if (ref.kind === "github-project") {
		return {
			key: ref.key,
			tracker: ref.tracker,
			owner: ref.owner,
			number: ref.number,
		};
	}
	const host = refHost(ref);
	return host === undefined
		? { key: ref.key, tracker: ref.tracker }
		: { key: ref.key, tracker: ref.tracker, host, name: `${host}/${ref.key}` };
}

/**
 * The key of a repo or project in `expectedBots`, `pmBot`, `autoMerge` and the
 * auto-merge values that a poll reads. A declared host qualifies the key, so that
 * the same name on github.com keeps its own value.
 */
export function settingsKey(key: string, host: string | undefined): string {
	return host === undefined ? key : `${host}/${key}`;
}

/** The declared host of a project, or undefined for a project on its tracker's own host. */
export function refHost(ref: ProjectRef): string | undefined {
	return ref.kind === "github-repo" ? ref.host : undefined;
}

/** The configuration form of a ProjectRef. */
export function refPin(ref: ProjectRef): ProjectPin {
	switch (ref.kind) {
		case "linear-project":
			return { tracker: "linear", project: ref.key };
		case "github-repo":
			return {
				tracker: "github",
				repo: ref.key,
				...(ref.host === undefined ? {} : { host: ref.host }),
			};
		case "github-project":
			return { tracker: "github", owner: ref.owner, project: ref.number };
	}
}

/** The repo of a GitHub repo project, or null for any other kind. */
export function refRepo(ref: ProjectRef): string | null {
	return ref.kind === "github-repo" ? ref.key : null;
}

/** The owner and number of a project on a board, or null for any other kind. */
export function refBoard(
	ref: ProjectRef,
): { owner: string; number: number } | null {
	return ref.kind === "github-project" ? ref : null;
}

/** A string that two ProjectRefs share when they name the same project. */
export function projectId(ref: ProjectRef): string {
	const key = ref.tracker === "github" ? ref.key.toLowerCase() : ref.key;
	const host = refHost(ref);
	return host === undefined
		? `${ref.kind}:${key}`
		: `${ref.kind}:${host}/${key}`;
}

export function sameProject(left: ProjectRef, right: ProjectRef): boolean {
	return projectId(left) === projectId(right);
}

export function samePin(left: ProjectPin, right: ProjectPin): boolean {
	return sameProject(pinRef(left), pinRef(right));
}
