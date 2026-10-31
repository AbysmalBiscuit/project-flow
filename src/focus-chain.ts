import type { FocusLink } from "./domain.ts";

/** The focused ids plus every id upstream or downstream of them through the links. */
export function focusChain(
	seeds: ReadonlySet<string>,
	links: readonly FocusLink[],
): ReadonlySet<string> {
	const chain = new Set(seeds);
	const walk = (next: (id: string) => string[]) => {
		const queue = [...seeds];
		const seen = new Set(seeds);
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			for (const other of next(id)) {
				if (!seen.has(other)) {
					seen.add(other);
					chain.add(other);
					queue.push(other);
				}
			}
		}
	};
	walk((id) => links.filter((link) => link.to === id).map((link) => link.from));
	walk((id) => links.filter((link) => link.from === id).map((link) => link.to));
	return chain;
}
