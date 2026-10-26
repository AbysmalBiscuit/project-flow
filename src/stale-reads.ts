type Stored = { status: number; body: unknown };

/** The answer to a read that has no stored response yet. */
export const pendingStatus = 202;

/**
 * Answers each read at once from its last stored response, and reads it again
 * in the background. `changed` runs when a background read stores a new answer.
 */
export function staleReads(changed: () => void) {
	const stored = new Map<string, Stored>();
	const reading = new Set<string>();
	const revalidate = (key: string, read: () => Promise<Response>) => {
		if (reading.has(key)) {
			return;
		}
		reading.add(key);
		void (async () => {
			const response = await read();
			const next = { status: response.status, body: await response.json() };
			const before = stored.get(key);
			stored.set(key, next);
			if (JSON.stringify(before) !== JSON.stringify(next)) {
				changed();
			}
		})()
			.catch(() => {})
			.finally(() => {
				reading.delete(key);
			});
	};
	return (key: string, read: () => Promise<Response>): Response => {
		revalidate(key, read);
		const known = stored.get(key);
		return known === undefined
			? Response.json({ pending: true }, { status: pendingStatus })
			: Response.json(known.body, { status: known.status });
	};
}
