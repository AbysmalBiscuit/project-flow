import type { Backends } from "./backends.ts";
import type { PullRequest } from "./domain.ts";
import type { Forge, TrackedProject, Tracker } from "./ports.ts";
import { refRepo } from "./project-ref.ts";
import { linksByForge } from "./pull-links.ts";

export type ListedPulls = {
	lists: { forge: Forge; pulls: PullRequest[] }[];
	/** The message of a forge whose token is missing, whose PRs the lists leave out. */
	missingToken: string | null;
};

/** The PRs of a project, each list with the forge that read it. */
export async function listPulls(
	backends: Backends,
	project: TrackedProject,
	tracker: Tracker,
	since: Date | null,
): Promise<ListedPulls> {
	const refs = await tracker.pullRefs?.(project, since);
	if (refs !== undefined) {
		const { links: byForge, missing } = linksByForge(refs, backends.linkOf);
		const lists: ListedPulls["lists"] = [];
		for (const [forge, links] of byForge) {
			const repos = links.map((link) => link.repo);
			lists.push({ forge, pulls: await forge.listLinkedPulls(links, repos) });
		}
		return { lists, missingToken: missing };
	}
	const forge = backends.forgeOf(project.ref);
	if (forge === null) {
		return { lists: [], missingToken: null };
	}
	const repo = refRepo(project.ref);
	if (repo !== null) {
		return {
			lists: [{ forge, pulls: await forge.listPulls(repo) }],
			missingToken: null,
		};
	}
	const linked = await tracker.pullLinks?.(project);
	return {
		lists:
			linked === undefined
				? []
				: [
						{
							forge,
							pulls: await forge.listLinkedPulls(linked.links, linked.repos),
						},
					],
		missingToken: null,
	};
}
