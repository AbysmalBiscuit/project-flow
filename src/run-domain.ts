import type { RunResult, RunStatusKind } from "./kinds.ts";
export type WorkcellRun = {
	key: string;
	status: "running" | "failed";
	repo?: string;
};

export type LiveRun = {
	status: "running" | "failed";
	stage?: string;
};

/** An open question that a blocked run waits on, from `GET /runs/{id}/questions`. */
export type FactoryQuestion = { id: string; text: string };

/** One message of a run thread: an ask of the run, an answer to an ask, or a delivered steer. */
export type RunMessage = {
	kind: "ask" | "answer" | "steer";
	/** The stage that asks, or the person who answers or steers. */
	sender: string;
	text: string;
	/** The markdown of `text`, rendered and sanitized on the server like a ticket comment. */
	html: string;
	/** The id of the ask, on an ask message. */
	question?: string;
	/** The time of the message as an ISO string. */
	at: string;
};

/** A workcell run that a factory reports in `GET /runs`. */
export type FactoryRun = {
	id: string;
	key: string;
	repo?: string;
	statusKind: RunStatusKind;
	/** The box that does the run. Null while the run waits in the hub queue. */
	box: string | null;
	factory: string;
	/** The hub source that started the run. */
	source?: string;
	/** The factory that lists `source`. A box that does the run can give `factory` another name. */
	sourceFactory?: string;
	/** The hub rule that started the run. */
	rule?: string;
	/** The id of the queued start that the hub sent as this run. */
	queuedId?: string;
	submittedAt: string;
	startedAt: string | null;
	endedAt: string | null;
	/** False when the factory did not answer its last read. */
	coveredByFeed: boolean;
	/** True when the factory serves an event stream, which gives the stage. */
	streamed: boolean;
	/** The path of the run's current node, from the event stream. */
	stage?: string;
	/** The open questions of a blocked run. Absent when the factory gave no list. */
	questions?: FactoryQuestion[];
	/** The asks, answers and delivered steers of the run, oldest first. Absent until the run has one. */
	thread?: RunMessage[];
	/** Why the run failed, as the factory gives it. */
	failureReason?: string;
	/** The PR that the run opened, from `GET /runs/{id}`. Absent until the factory names one. */
	pull?: RunPull;
	/** The id of the run that this run restarted. */
	restartedFrom?: string;
	/** When Lev archived the run. The Runs list hides an archived run until its archive filter shows it. */
	archivedAt?: string;
	/** The sums of the run's agent turns, from `GET /runs`. Absent when the factory gives none. */
	usageTotals?: UsageTotals;
};

/** The PR that a run opened, as the factory gives it from the run's `pr_url` output. */
export type RunPull = {
	repo: string;
	/** The declared host of the PR. A PR on github.com has none. */
	host?: string;
	number: number;
	url: string;
	/** True when the run recorded the merge of its PR. */
	merged: boolean;
};

/** The last box event of a run that the event stream gave. */
export type RunEvent = {
	event: string;
	/** The node path that the event names. */
	stage: string;
	/** The time that the box recorded the event, as an ISO string. */
	at?: string;
};

/** One event of the Events tab: a box event of a run, with the id that the factory gives it. */
export type RunLogEvent = Required<RunEvent> & { id: string; data: unknown };

/**
 * Why the event stream of a run ended: the run ended, the factory does not serve
 * the route, or the factory stopped answering.
 */
export type RunEventsEnd = { reason: "ended" | "not served" | "unreachable" };

/** A file that a run stage wrote in its stage folder, or a value that it added to the artifact store. */
export type RunArtifact = {
	/** The path of the stage folder in the run folder, such as `implement@v1.a1`. One stage has one folder for each visit. */
	folder: string;
	/** The path of the stage through the child graphs, such as `review/verdict`. */
	stage: string;
	/** The path of the file in the stage folder, such as `response.md`. */
	name: string;
	/** The media type. */
	type: string;
	/** The size in bytes. */
	size: number;
};

/** One run artifact with its content: text for `utf-8`, and base64 for any other file. */
export type RunArtifactContent = RunArtifact & {
	encoding: "utf-8" | "base64";
	content: string;
};

/** Where a run does its work: the machine, the worktree and its git state. */
export type RunSandbox = {
	/** The hostname of the machine that runs the run. */
	host: string;
	/** Null before the run sets up a worktree. */
	worktree: string | null;
	branch: string | null;
	/** The commit of the worktree. */
	head: string | null;
	/** The base branch of the run's PR. Null when no base resolves. */
	base: string | null;
	/** The commits on the branch that the remote base lacks. Null when no base resolves. */
	ahead: number | null;
	/** `none` before the run sets up a worktree, and `removed` after the worktree is gone. */
	state: "none" | "removed" | "clean" | "dirty";
	/** Each `git status --porcelain` line of the worktree. */
	changes: string[];
};

/** A file that a run's branch changed since it left its base, as a GitHub pull request shows it. */
export type RunFile = {
	path: string;
	/** The path before a rename. */
	previousPath?: string;
	status: "added" | "modified" | "deleted" | "renamed";
	/** A binary file counts no lines. */
	additions: number;
	deletions: number;
	/** The `git diff` of the file. */
	patch: string;
};

/** The graph files that a run loaded from its package, as the run loaded them. */
export type RunSource = {
	/** The path of the entry graph in the package, such as `pre_pr.dot`. */
	entry: string;
	/** The entry graph first, then each child graph that it calls, by its path in the package. */
	graphs: { path: string; text: string }[];
};

/** One record of the agent of a run stage: a message, or a tool call with its cut input. */
export type TranscriptEntry = {
	/** The cursor of the entry. A read with `after` set to it gives the entries after it. */
	id: number;
	/** The stage folder of the visit and attempt that recorded the entry. */
	folder: string;
	visit: number;
	attempt: number;
	at: string;
} & (
	| { kind: "message"; text: string }
	| { kind: "tool_call"; name: string; input: string; truncated: boolean }
	| { kind: "steer"; text: string; sender: string; interrupt: boolean }
);

/**
 * One page of a stage transcript. `next` is the cursor of the next read.
 * `ended` is true when the page holds the last entry of a stage that has ended.
 */
export type StageTranscript = {
	entries: TranscriptEntry[];
	next: number;
	ended: boolean;
};

/** A value that a run's package parameter takes, as JSON. */
export type ParameterValue =
	| string
	| number
	| boolean
	| null
	| ParameterValue[]
	| { [key: string]: ParameterValue };

/** What a run was asked to do. The factory leaves out each token and secret. */
export type RunSettings = {
	/** The workflow package that the run runs. */
	workflowPackage: string;
	/** Each package parameter that the entry graph declares, with the value that the run takes. */
	parameters: { name: string; value: ParameterValue }[];
	/** Why the run's package would refuse the parameters. Null when it takes them. */
	parametersError: string | null;
	/** The harness, model and effort that each agent node of the entry graph starts on. Null takes the default. */
	choices: {
		node: string;
		/** `headless` or `pane`. */
		mode: string;
		launcher: string | null;
		harness: string | null;
		model: string | null;
		effort: string | null;
		/** Why the node cannot start. */
		error: string | null;
	}[];
	/** The options of the request that started the run. */
	options: {
		repo: string;
		ticket: string;
		author: string;
		keepWorktree: boolean;
		/** True when a hub sent the run to its box. */
		sent: boolean;
		/** The hub source and dispatch rule that started the run. */
		source: string | null;
		rule: string | null;
	};
};

/** A workcell run with the facts that its run page shows. */
export type RunDetail = FactoryRun & {
	/** The name of the run's workflow graph. */
	workflow?: string;
	lastEvent?: RunEvent;
	/** Present when Lev can resume or restart the run. */
	resumable?: true;
};

/**
 * The newest factory run of a ticket. The stage comes from the event stream,
 * or from the progress comment when the factory serves no event stream.
 */
export type ShownFactoryRun = Pick<
	FactoryRun,
	| "id"
	| "statusKind"
	| "box"
	| "factory"
	| "source"
	| "rule"
	| "startedAt"
	| "endedAt"
	| "coveredByFeed"
	| "questions"
	| "thread"
> & {
	stage?: string;
	result?: RunResult;
	/** Present when Lev can resume or restart the run: it is blocked or failed, and its ticket is open. */
	resumable?: true;
};

/** How a Linear ticket shows a state name of a hub source: its workflow state, and the labels to add and to remove. */
export type LinearShown = { state: string; add: string[]; remove: string[] };

/** A Linear source of a listed hub: its team, how it shows each state name, and the match of each dispatch rule. */
export type LinearSource = {
	factory: string;
	team: string;
	linearStates: Record<string, LinearShown>;
	rules: { state: string; labels: string[]; without: string[] }[];
};

/**
 * How Lev starts a factory run, and the factory that it names.
 * A GitHub ticket gets the ready label. A Linear ticket gets the workflow state
 * and the labels that its hub source maps to the state of a dispatch rule.
 * Only a claim on a factory is left when a GitHub ticket has no ready label.
 */
export type RunStart = (
	| { factory: string; label: string }
	| ({ factory: string; label?: never } & LinearShown)
	| { factory?: never; label?: never }
) & {
	/** True when a start or an accepted claim waits for its run: no run has started since it. */
	requested?: true;
};

/**
 * The factory that a ticket waits for, and what queued it. A GitHub ticket carries the
 * ready label or ready status of the factory. A Linear ticket shows the state and labels
 * of a ready rule of its hub source, and `status` names that state.
 */
export type Queued = {
	factory: string;
	label?: string;
	status?: string;
};

/** Where a factory run is in its flow, from the run checkpoint of its box. */
export type RunCheckpoint = {
	/** The path of the current stage. Null when the run is at no stage. */
	stage: string | null;
	/** The stages that the run finished, in order. */
	completedStages: string[];
	/** The retries of each stage, by stage name. */
	retries: Record<string, number>;
	/** The visits of each stage, by stage name. A review stage visit is one review round. */
	visits: Record<string, number>;
	/** The run context: the values that the run's stages wrote, by key. */
	context: Record<string, unknown>;
	/** The usage of the run's recorded turns. Absent when the factory gave no turns. */
	usage?: RunUsage;
	/** True when the factory answers the turns read with 404. */
	usageNotServed?: true;
	/** The run's workflow graph with the state of each stage. Null when the factory serves no graph. */
	graph: RunGraph | null;
};

/** The usage of some agent turns: tokens, cost in US dollars, time in seconds, and the count of each tool. */
export type TurnUsage = {
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	durationS: number;
	tools: Record<string, number>;
};

/** The tokens, cost and time of some agent turns, without the tool counts. */
export type UsageTotals = Omit<TurnUsage, "tools">;

/** The usage of each stage of a run, by stage name, and their sum. */
export type RunUsage = {
	stages: Record<string, TurnUsage>;
	total: TurnUsage;
};

/** What the agent of one stage of a live run does now, from `GET /runs/{id}/workers`. */
export type RunAgent = {
	/** The node path of the stage that the agent works on. */
	stage: string;
	/** The tool that the agent uses now. Null between tool calls and after its turn. */
	tool: string | null;
	/** The last line of the agent's last message. Null before its first message. */
	lastMessage: string | null;
	turn: "running" | "ended";
};

/**
 * Where a stage of a run's workflow graph is: the current stage, a completed
 * stage, a stage ahead, or the stage where the run failed.
 */
export type RunGraphNodeState = "current" | "completed" | "ahead" | "failed";

/** One stage of a run's workflow graph. A stage of a child graph has the path `caller/stage` as its id. */
export type RunStage = {
	id: string;
	label: string;
	state: RunGraphNodeState;
	visits: number;
	retries: number;
};

export type RunGraphNode = RunStage & {
	/** The Graphviz shape of the workflow node. */
	shape: string;
	/** The workcell handler that the node runs, such as `codergen` or `wait.human`. */
	kind: string;
	/**
	 * The child graph that the stage calls. The factory serves only the entry
	 * graph, so the stages are those that the checkpoint records over all the
	 * calls, ended and live.
	 */
	child?: RunStage[];
};

export type RunGraphEdge = {
	from: string;
	to: string;
	label?: string;
	condition?: string;
};

/** The workflow graph of a factory run, from `GET /runs/{id}/graph` of its box. */
export type RunGraph = { nodes: RunGraphNode[]; edges: RunGraphEdge[] };

/** A factory run of a ticket that a newer run replaced, such as a failed run before its retry. */
export type EarlierFactoryRun = Pick<
	FactoryRun,
	"statusKind" | "factory" | "startedAt" | "endedAt"
> & { result?: RunResult };
