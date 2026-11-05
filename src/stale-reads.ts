type Stored = { status: number; body: unknown };

/** The answer to a read that has no stored response yet. */
export const pendingStatus = 202;

/**
 * Answers each read at once from its last stored response, and reads it again
 * in the background. `answered` runs once per key, when its first answer lands.
 * A signal on each later change would make the page read again, and each read
 * starts another background read, so a source that keeps changing never settles.
 */
export function staleReads(answered: () => void) {
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
			const first = !stored.has(key);
			stored.set(key, next);
			if (first) {
				answered();
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
