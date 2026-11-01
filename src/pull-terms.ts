/** The copy of the actions that Lev takes on a PR through its forge. */

export const mergeGateReason = {
	failedCheck: "A check failed",
	pendingCheck: "A check is pending",
	openQuestion: "An Important Question is open",
	notAwaiting: "The PR is not in Awaiting merge",
	noCapability: "The forge of the PR cannot merge",
} as const;

export const requestChangesCopy = {
	action: (number: number) => `Request changes #${number}`,
	sending: "Sending review",
	title: "Request changes",
	body: (number: number, title: string) =>
		`PR #${number}, ${title}, gets a review that asks for changes.`,
	label: "Review text",
	placeholder: "Describe the changes",
	confirm: "Request changes",
	dismiss: "Cancel",
	failed: "Request changes failed",
	empty: "The review text is empty",
	noCapability: "The forge of the PR cannot request changes",
} as const;

export const pullMergeCopy = {
	merge: (number: number) => `Merge #${number}`,
	blocked: (number: number, reason: string) => `Merge #${number}: ${reason}`,
	choices: "Merge choices",
	merging: "Merging",
	title: "Merge the PR?",
	body: (number: number, title: string, base: string | undefined) =>
		base === undefined
			? `PR #${number}, ${title}, merges into its target branch.`
			: `PR #${number}, ${title}, merges into ${base}.`,
	confirm: "Merge",
	dismiss: "Keep open",
	failed: "Merge failed",
} as const;
