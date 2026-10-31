export function sameRepo(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

/** The key that a record keeps for a repo, whatever its case. */
export function repoKey(
	record: Readonly<Record<string, unknown>>,
	repo: string,
): string | undefined {
	return Object.keys(record).find((key) => sameRepo(key, repo));
}
