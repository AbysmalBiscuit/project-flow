# Project Flow

Project Flow shows how Lev's projects and tickets progress, across GitHub and Linear, in one place. It shows what is done, what moves, what is blocked, and what waits on Lev.

## Language

### Work

**Project**:
A body of work that Project Flow tracks: a Linear project, a GitHub project, or a GitHub repo whose tickets are in no GitHub project.
_Avoid_: Board, repo (when a project is meant)

**Found project**:
A project that Project Flow finds from tracker membership or from a local checkout. Settings lists each found project. Project Flow polls a found project only when it is a tracked project. On Linear, Lev is a member or the lead. On GitHub, Lev owns the project, or he owns or collaborates on the repo.
_Avoid_: Discovered project, membership project

**Tracked project**:
A project that the configuration names in its tracked list. Project Flow sends ticket, PR and branch requests only for tracked projects. Only tracked projects show on the overview.
_Avoid_: Pinned project, hidden project, watched project

**Ticket**:
One unit of tracked work: a GitHub issue or a Linear issue.
_Avoid_: Issue, task, item

**Parent ticket**:
A ticket that other tickets sit under in the tracker. A parent ticket is outside when the project's tickets do not include it.
_Avoid_: Parent issue

**Sub-ticket**:
A ticket that sits under a parent ticket.
_Avoid_: Child ticket, sub-issue

**Unlinked PR**:
An open PR that links to no ticket, through a closing reference, a tracker attachment, or its branch name.
_Avoid_: Orphan PR, loose PR

**Tracker**:
The external system that owns a ticket: GitHub or Linear.
_Avoid_: Source, provider, tool

### Grouping

**Parent ticket**:
A ticket that other tickets name as their parent in the tracker.
_Avoid_: Epic (when a parent ticket is meant), parent issue

**Sub-ticket**:
A ticket that has a parent ticket.
_Avoid_: Child, subtask, sub-issue

**Workstream**:
The top group in a project map: on GitHub the root epic, else the milestone, else the top parent ticket; on Linear the project milestone. A top parent ticket with no workstream takes the most common workstream in its tree of sub-tickets. Another ticket with no workstream takes the workstream of its top parent ticket.
_Avoid_: Area, epic, feature area

**Theme**:
The group inside a workstream: the epic or top parent ticket, else the scope in the ticket title (`feat(ux): ...`).
_Avoid_: Category, scope group

**Parent ticket frame**:
The box around the sub-tickets of a parent ticket on the project graph, when the graph groups by workstream or theme. The parent ticket card heads the frame. A parent ticket that a filter hides still heads the frame of its shown sub-tickets. A group that holds a sub-ticket of a parent ticket from another group heads its frame with a copy of the parent ticket card. An outside parent ticket heads the frame of its sub-tickets as a dashed outside card, with its title and state.
_Avoid_: Parent box, epic frame

### State

**State**:
The place of a ticket in its workflow. The tracker status sets the state. GitHub evidence and workcell evidence move it forward. Issue #97 holds the operating rules.
_Avoid_: Status (when the state is meant), column

**Lane**:
The column a ticket sits in on a project board. Tracker statuses set the lanes. A repo without statuses uses its factory labels or the app's lanes.
_Avoid_: Column, status column

**Blocked**:
A flag on a ticket in any state. The ticket has at least one open blocker. The ticket stays in the lane of its state.
_Avoid_: Blocked state

**Stale status**:
The tracker status when that status lags the state.
_Avoid_: Stale, out of date, wrong status

**Run failed**:
A workcell run that failed or stalled. The ticket returns to the lane of its tracker status.
_Avoid_: Failed, error, stalled

**Done**:
A ticket the tracker closed as completed, or whose merged PR closes it.

**Dropped**:
A closed ticket that was cancelled or closed as not planned.
_Avoid_: Cancelled, won't do

**In progress**:
An open ticket in started work. The tracker status can set it. A live run, a pushed branch, a started todo, or a draft PR can set it. The least advanced open PR decides.
_Avoid_: Started, active

**In review**:
An open ticket in a review that has begun and has not finished. The tracker status or an open PR out of draft sets it. The least advanced open PR decides.
_Avoid_: Under review, PR open

**Awaiting merge**:
An open ticket whose every open PR has finished its review cycle and waits for a human to merge it. Auto-merge is off, or auto-merge is set to ask. A ticket stays In review until its PR merges when its reviews are done and auto-merge is on.
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
The tickets or projects that Lev selects with Ctrl-click or a double-click. The view shows the chain of each one at full strength and fades the rest. An empty focus set ends focus mode.
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
One run of the workcell manage flow on a ticket. Its progress comment shows the run's stage.
_Avoid_: Job, session

### Attention

**Needs you**:
A ticket or PR that only Lev can move. Reasons include an open ask to Lev, awaiting merge, or a failed or stalled workcell run. A need-human or need-engineer label with Lev as assignee also counts.
_Avoid_: Waits on you, waits on Lev, needs Lev

**Ask**:
A question that an agent posts on a ticket or PR with an ask marker. It stays open until a later comment or the progress comment answers it.
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
