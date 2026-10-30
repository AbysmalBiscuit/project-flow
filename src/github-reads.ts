import type { Ticket } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { listProjectItems, type ProjectItem } from "./github-project-items.ts";
import { readRepo, type StoredLists } from "./github-repo.ts";

export type GithubReads = ReturnType<typeof githubReads>;

/** One read of each repo and GitHub project in a poll, which the tracker and the forge share. */
export function githubReads(token: string, fetchImpl: Fetch) {
	const storedLists: StoredLists = { issues: new Map(), pulls: new Map() };
	const projectItemsById = new Map<string, Promise<ProjectItem[]>>();
	const repoSnapshots = new Map<string, ReturnType<typeof readRepo>>();
	return {
		clear() {
			repoSnapshots.clear();
			projectItemsById.clear();
		},
		forget(key: string) {
			repoSnapshots.delete(key);
			projectItemsById.delete(key);
		},
		projectItems(projectId: string, projectOwner: string) {
			const cached = projectItemsById.get(projectId);
			if (cached !== undefined) {
				return cached;
			}
			const listed = listProjectItems(
				token,
				fetchImpl,
				projectId,
				projectOwner,
			).catch((error: unknown) => {
				if (projectItemsById.get(projectId) === listed) {
					projectItemsById.delete(projectId);
				}
				throw error;
			});
			projectItemsById.set(projectId, listed);
			return listed;
		},
		repo(repo: string, since: Date | null, held: Ticket[] = []) {
			const cached = repoSnapshots.get(repo);
			if (cached !== undefined) {
				return cached;
			}
			const read = readRepo(
				token,
				fetchImpl,
				repo,
				since,
				storedLists,
				held,
			).catch((error: unknown) => {
				if (repoSnapshots.get(repo) === read) {
					repoSnapshots.delete(repo);
				}
				throw error;
			});
			repoSnapshots.set(repo, read);
			return read;
		},
		/** The read of this poll, or undefined when no read of the repo started. */
		startedRepo(repo: string) {
			return repoSnapshots.get(repo);
		},
	};
}
