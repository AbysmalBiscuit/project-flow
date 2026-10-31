/** The fixed categories in workflow order. The domain rules read only these. */
export const statusTypes = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
	"dropped",
] as const;

export type StatusType = (typeof statusTypes)[number];

export const runStatusKinds = [
	"queued",
	"starting",
	"running",
	"blocked",
	"failed",
	"succeeded",
] as const;

export type RunStatusKind = (typeof runStatusKinds)[number];

/** What the work of an ended run came to. A live or queued run has no result yet. */
export const runResults = [
	"merged",
	"prOpen",
	"noPr",
	"failed",
	"cancelled",
] as const;

export type RunResult = (typeof runResults)[number];

/** The run statuses of a run that has ended. Lev can cancel or steer a run in any other status. */
export const endedRunStatusKinds = [
	"failed",
	"succeeded",
] as const satisfies readonly RunStatusKind[];

/** The run statuses that Lev can resume from the run checkpoint, or restart from the first stage. */
export const resumableRunStatusKinds = [
	"blocked",
	"failed",
] as const satisfies readonly RunStatusKind[];

/** The run statuses whose agents can work: the app reads a run's agents only in these. */
export const liveRunStatusKinds = [
	"starting",
	"running",
	"blocked",
] as const satisfies readonly RunStatusKind[];
