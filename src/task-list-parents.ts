const taskListItem = /^\s*[-*+]\s+\[[ xX]\]\s+#(\d+)\b/gm;

/**
 * The parent of each ticket number in one repo, for a tracker with no
 * sub-tickets. A task list item `- [ ] #12` makes the ticket that holds it
 * the parent of #12. The first ticket that lists a number is its parent.
 */
export function taskListParents(
	tickets: readonly { number: number; body: string | null }[],
): Map<number, number> {
	const parents = new Map<number, number>();
	for (const ticket of tickets) {
		for (const [, named] of (ticket.body ?? "").matchAll(taskListItem)) {
			const child = Number(named);
			if (child !== ticket.number && !parents.has(child)) {
				parents.set(child, ticket.number);
			}
		}
	}
	return parents;
}
