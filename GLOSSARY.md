# Project Flow

Project Flow shows how Lev's projects and tickets progress, across GitHub and Linear, in one place. It shows what is done, what moves, what is blocked, and what waits on Lev.

## Language

### Work

**Project**:
A body of work that Project Flow tracks: a Linear project, a GitHub project, or a GitHub repo whose tickets are in no GitHub project.
_Avoid_: Board, repo (when a project is meant), GitLab project (when a Project Flow project is meant)

**Found project**:
A project that Project Flow finds from tracker membership or from a local checkout. Settings lists each found project. Project Flow polls a found project only when it is a tracked project. On Linear, Lev is a member or the lead. On GitHub, Lev owns the project, or he owns or collaborates on the repo.
_Avoid_: Discovered project, membership project

**Tracked project**:
A project that the configuration names in its tracked list. Project Flow sends ticket, PR and branch requests only for tracked projects. Only tracked projects show on the overview.
_Avoid_: Pinned project, hidden project, watched project

**Ticket**:
One unit of tracked work: a GitHub issue or a Linear issue.
_Avoid_: Issue, task, item

**PR**:
A request on a forge to merge one branch into another. Project Flow uses this term for a GitHub pull request, a GitLab merge request and a Forgejo pull request.
_Avoid_: Merge request, MR

**Unlinked PR**:
An open PR that links to no ticket, through a closing reference, a tracker attachment, or its branch name. The board, the graph and the table show each unlinked PR as a card in the "Unlinked PRs" group. The card shows the PR number, the title and the link. The review cycle sets its state: In progress for a draft, In review, or Awaiting merge. The card sits in the lane of that state, and the Ticket filter applies to it as to a ticket.
_Avoid_: Orphan PR, loose PR

**Tracker**:
The external system that owns a ticket, such as GitHub or Linear. It holds the ticket's status, labels, parent ticket and blocker links.
_Avoid_: Source, provider, tool

**Forge**:
The external system that hosts the git refs and PRs of a repo, such as GitHub, GitLab or Forgejo. It holds the branches, the reviews, the checks and the merge state. A ticket's tracker and its repo's forge can be different systems.
_Avoid_: Code host, git provider

### Grouping

**Parent ticket**:
A ticket that other tickets sit under in the tracker. A parent ticket is outside when the project's tickets do not include it.
_Avoid_: Epic (when a parent ticket is meant), parent issue

**Sub-ticket**:
A ticket that sits under a parent ticket.
_Avoid_: Child, child ticket, subtask, sub-issue

**Workstream**:
The top group in a project map: on GitHub the root epic, else the milestone, else the top parent ticket; on Linear the project milestone. On GitHub, a top parent ticket with no workstream and an outside parent ticket takes the outside parent ticket as its workstream. That workstream group shows the outside parent ticket as a dashed outside card, with its title, state and link. A top parent ticket with no workstream takes the most common workstream in its tree of sub-tickets. Another ticket with no workstream takes the workstream of its top parent ticket.
_Avoid_: Area, epic, feature area

**Theme**:
The group inside a workstream: the epic or top parent ticket, else the scope in the ticket title (`feat(ux): ...`).
_Avoid_: Category, scope group

**Parent ticket frame**:
The box around the sub-tickets of a parent ticket on the project graph, when the graph groups by workstream or theme. The parent ticket card heads the frame. The frame keeps its done sub-tickets, also without a blocker link. The Ticket filter still hides them, as on the board. A parent ticket that a filter hides still heads the frame of its shown sub-tickets. A group that holds a sub-ticket of a parent ticket from another group heads its frame with a copy of the parent ticket card. An outside parent ticket heads the frame of its sub-tickets as a dashed outside card, with its title and state. The frame of an outside parent ticket has a dashed border, with the same dash as the outside card. The frame of a local parent ticket has a solid border.
_Avoid_: Parent box, epic frame

### State

**Category**:
One of the fixed places of a ticket in its workflow: backlog, in progress, in review, awaiting merge, done or dropped. The tracker status sets the category. GitHub evidence and workcell evidence move it forward. The domain rules read only the category. Issue #97 holds the operating rules.
_Avoid_: Status type

**State**:
A place in the user's workflow, with a label and a colour. The configuration file holds the states in board order. Each state holds one or more categories. A state mapping or the ticket's category puts each ticket in one state.
_Avoid_: Status (when the state is meant), column

**State mapping**:
The link from a tracker status or a label of one board to a state. Settings edits it.
_Avoid_: Lane mapping (when a state is meant)

**State colour**:
The colour that draws one state on the board, the cards, the graphs, the legend and the side panel. Both themes use it. The first state of a category gives the colour of that category. Settings edits it.
_Avoid_: Status colour, lane colour

**Lane**:
The place of one state on a project board. Each state has one lane, in the order of the states.
_Avoid_: Column, status column

**Blocked**:
A flag on a ticket in any state. The ticket has at least one open blocker. The ticket stays in the lane of its state.
_Avoid_: Blocked state

**Stale status**:
The tracker status when that status lags the state.
_Avoid_: Stale, out of date, wrong status

**Run failed**:
A workcell run that failed or stalled. The ticket drops the evidence that the run gave: a live run, a started todo and a pushed branch. Evidence from PRs still moves the ticket forward, so an open PR can set In progress, In review or Awaiting merge. With no such PR, the ticket returns to the lane of its tracker status.
_Avoid_: Failed, error, stalled

**Done**:
A ticket the tracker closed as completed, or whose merged PR closes it.

**Dropped**:
A closed ticket that was cancelled or closed as not planned.
_Avoid_: Cancelled (when a ticket is meant), won't do

**In progress**:
An open ticket in started work. The tracker status can set it. A live run, a pushed branch, a started todo, or a draft PR can set it. The least advanced open PR decides.
_Avoid_: Started, active

**In review**:
An open ticket in a review that has begun and has not finished. The tracker status or an open PR out of draft sets it. The least advanced open PR decides.
_Avoid_: Under review, PR open

**Awaiting merge**:
An open ticket whose every open PR has finished its review cycle and waits for a human to merge it. Auto-merge is off, or auto-merge is set to ask. A ticket stays In review until its PR merges when its reviews are done and auto-merge is on. The workcell `merge_auto` setting applies only to a PR that a workcell run opened. A factory run reports such a PR, or a workcell progress comment names it.
_Avoid_: Ready, pending merge, mergeable

**Backlog**:
An open ticket that has not moved forward from its tracker status, and whose tracker status is the start of the workflow.
_Avoid_: Todo, not started

**Blocker**:
An open ticket that another ticket depends on.

**Cross-project blocker**:
A blocker that belongs to a different project than the ticket it blocks.
_Avoid_: External blocker, outside dependency

### Focus

**Chain**:
A ticket and every ticket upstream or downstream of it through blocker links. On the overview, a chain is a project and every project upstream or downstream of it through cross-project blockers.
_Avoid_: Path, lineage, dependency tree

**Focus set**:
The tickets or projects that Lev selects with Shift-click or a double-click. The view shows the chain of each one at full strength and fades the rest. An empty focus set ends focus mode.
_Avoid_: Selection, highlight

**Preview**:
The chain of the ticket or project under the pointer. The preview starts after the pointer stays for a short delay. The preview ends when the pointer leaves or when the focus set changes.
_Avoid_: Hover focus, peek

### Review

**Review cycle**:
The automated review a PR gets before a human merges it: the review rounds of a workcell run, else the passes of the expected bots.
_Avoid_: Bot review, review loop

**Expected bot**:
A review bot that a repo's PRs normally get, as found in the repo's recent PRs or set in the config.
_Avoid_: Reviewer, required check

**Workcell run**:
One run of the workcell manage flow on a ticket. The factory reports the run's status and stage. When the factory serves no event stream, the progress comment shows the stage.
_Avoid_: Job, session

### Factory

**Factory**:
A workcell daemon that Project Flow reads runs from, with the boxes it dispatches to. A personal factory is one daemon with no boxes. Project Flow can read several factories.
_Avoid_: Daemon, workcell daemon, fleet, server

**Hub**:
A factory daemon that takes runs and dispatches them to boxes. It knows the status of every run it dispatched.
_Avoid_: Server, controller, orchestrator

**Box**:
A machine in the factory that does the runs the hub dispatches to it. Only the box holds the full detail of its runs.
_Avoid_: Machine, worker, node (when the box is meant), build machine

**Run stage**:
The step of the workcell flow that a run is in: a node of the run's graph.
_Avoid_: Phase, step, node (when the stage is meant)

**Run checkpoint**:
The snapshot that a box keeps of where a run is in its flow: the current stage, the completed stages, the retries and visits of each stage, and the run context. Each visit of a review stage is one review round. Project Flow reads it from `GET /runs/{id}/checkpoint` of the hub that reports the run, or else of its box.
_Avoid_: Run state, run detail

**Run usage**:
The input and output tokens, the cost, the time and the count of each tool of a run's agent turns. Project Flow gives it for each run stage and for the run. It reads it from `GET /runs/{id}/turns` of the factory that reports the run. A turn of a child graph counts toward the stage that calls the child graph.
_Avoid_: Run cost, spend

**Run artifact**:
A file that a run stage writes in its stage folder, such as its prompt or its response, or a value that the stage adds to the artifact store. A stage has one stage folder for each visit. Project Flow reads the run artifacts from `GET /runs/{id}/artifacts` of the hub that reports the run, or else of its box.
_Avoid_: Output, stage file

**Run sandbox**:
The place where a run does its work: the host of its box, its worktree, the branch and head of the worktree, the base branch of its PR, and the workspace state. The workspace state is clean, dirty, removed, or none before the run sets up a worktree. Project Flow reads the run sandbox from `GET /runs/{id}/sandbox` of the hub that reports the run, or else of its box.
_Avoid_: Workspace (when the whole sandbox is meant), environment

**Run files**:
The files that the branch of a run changed since it left its base, as a GitHub pull request shows them. Each file has its status, its line counts and its diff. Project Flow reads the run files from `GET /runs/{id}/files` of the hub that reports the run, or else of its box. The factory cannot read them after it removes the worktree of the run.
_Avoid_: Diff (when the whole list is meant)

**Workflow source**:
The text of the graph file that a run loaded, and of each child graph that it calls. The factory keeps the package that the run loaded, so a later edit of a graph file does not change the workflow source. Project Flow reads it from `GET /runs/{id}/source` of the hub that reports the run, or else of its box.
_Avoid_: Workflow file, DOT file

**Run settings**:
What a run was asked to do: its workflow package, the value of each package parameter, the harness, model and effort that each agent node starts on, and the options of its request. The factory leaves out each token and secret. Project Flow reads the run settings from `GET /runs/{id}/settings` of the hub that reports the run, or else of its box.
_Avoid_: Run config, settings (alone, which names the Settings page)

**Workflow package**:
The folder or archive that holds the graphs of a workflow and the files that they need. The factory keeps a copy of the package in the run folder, and the run reads only that copy.
_Avoid_: Bundle, workflow folder

**Package parameter**:
A graph attribute that a workflow package declares with a default. A repo can set its value for its runs, for example when to rebase or when to ask before a merge.
_Avoid_: Option, flag

**Agent node**:
A node of a workflow graph that starts an agent. The run settings give the harness, model and effort of each agent node.
_Avoid_: Agent step

**Run agent**:
The agent that works on one stage of a live run: its current tool, its last message and whether its turn runs or ended. Project Flow reads it from `GET /runs/{id}/workers` of the factory that reports the run, only while a view follows the run.
_Avoid_: Worker (when the agent is meant)

**Run thread**:
The talk with a run in time order: each ask of the run, each answer that Lev sends from Project Flow, and each steer that the factory reports delivered. Each message names its sender. Project Flow reads the open and answered asks from the factory, so the run thread keeps its asks and answers after a restart.
_Avoid_: Run chat, run log

**Stage transcript**:
The record of the agent of one run stage: each message of the agent and each tool call, in time order. The run thread is not part of it. Project Flow reads it from `GET /runs/{id}/stages/{node_path}/transcript` of the hub that reports the run, or else of its box. Each read gives the entries after the `after` cursor, so a view of a live stage reads only the new entries.
_Avoid_: Stage thread, stage chat, stage log

**Run context**:
The context values of a run now, such as its goal and the values that its stages reported. All stages of a run share one run context. The stage view shows it, because the factory serves no context for one stage. Project Flow reads it from the `context_values` of the run checkpoint.
_Avoid_: Stage context

**Stage pane**:
The pane beside the run graph that shows one run stage: its facts, its stage transcript and its context. The stage pane of a live stage also has a steer box for that stage.
_Avoid_: Details pane, stage drawer

**Run page**:
The page that shows all the detail of one workcell run, in tabs. The side panel of a ticket links to the run page of its run.
_Avoid_: Run view, run dashboard, run detail

**Resume**:
Lev continues a blocked or failed workcell run from its run checkpoint. The run keeps its id, its run thread and its run usage.
_Avoid_: Retry (when a whole run is meant), rerun

**Restart**:
Lev starts a new workcell run on the ticket of a blocked or failed run, from the first run stage. The new run names the run it restarted from. The restart cancels a blocked old run, and a failed old run stays as it was.
_Avoid_: Retry (when a whole run is meant), rerun, resume (when a restart is meant)

**Queued ticket**:
An open ticket that meets the ready label or the ready status of a factory, and has no run that started after the request. A queued ticket waits for a source claim: the hub claims it on its next source pass. A ticket that a factory claimed through `POST /runs` is not queued, even before its run shows. Its card, row and panel head show a grey "Queued" chip. A queued ticket has no run, so the run filter does not match it.
_Avoid_: Waiting ticket, queued run (when the ticket is meant)

**Runs list**:
The table of every workcell run that the factories report, with search and filters. Each row links to its run page. Each row shows the cost of the run from the usage totals in `GET /runs`, and Lev can sort the rows by start or by cost.
_Avoid_: Run history, run log

**Ticket filter**:
The project page menu that hides tickets by lane, age, needs you, blocker and assignee. It applies to the board, the graph and the table.
_Avoid_: Filter (when the run filter can be meant)

**Run filter**:
The project page menu that hides tickets by their factory runs. "With runs only" keeps the tickets with a run mark. Each run status, run result and factory that Lev checks keeps the tickets with a matching run. A ticket with several runs matches when one of its runs matches. With "Latest run only" on, only the latest run of each ticket can match: the run that its card shows.
_Avoid_: Factory filter

**Run result**:
What the work of an ended run came to: merged, PR open, no PR, failed or cancelled. Project Flow derives it from the run status and the PR that the run opened. The factory gives that PR in `GET /runs/{id}`. A merged PR wins over the run status. A live or queued run has no run result.
_Avoid_: Run status (when the result is meant)

**Factory feed**:
The run status and stages that Project Flow reads live from the factory. Project Flow follows the factory's event stream, `GET /events`, and polls `GET /runs` only when the factory serves no event stream. Where the factory feed and a progress comment differ, the factory feed wins.
_Avoid_: Daemon feed, live feed

### Attention

**Needs you**:
A ticket or PR that only Lev can move. Reasons include an open ask to Lev, awaiting merge, or a failed or stalled workcell run. A need-human or need-engineer label with Lev as assignee also counts.
_Avoid_: Waits on you, waits on Lev, needs Lev

**Ask**:
A question that an agent posts on a ticket or PR with an ask marker, or that a workcell run asks through the factory. It stays open until a later comment, the progress comment or the factory answers it.
_Avoid_: Question, request, final report (when the ask is meant)

**PM Bot**:
The agent that answers asks before they reach Lev. A project with a PM Bot sends an unnamed ask to the PM Bot. A project with no PM Bot sends every ask to Lev.
_Avoid_: Senior, reviewer, PM

**Answered**:
A needs-you item that Lev replied to after its latest ask.

**Acknowledged**:
An answered item where an agent reacted to Lev's reply.
_Avoid_: Seen, read (when the acknowledged state is meant)

**Notification**:
An event the browser shows when a configured trigger fires: a new needs-you item, a new comment, or a cleared cross-project blocker.

**Inbox**:
The list of every notification Project Flow has raised.

**Read**:
A notification that Lev opened or marked read.
_Avoid_: Seen, acknowledged
