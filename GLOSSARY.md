# Project Flow

Project Flow shows how Lev's projects and tickets progress, across GitHub and Linear, in one place. It shows what is done, what moves, what is blocked, and what waits on Lev.

## Language

### Work

**Project**:
A body of work that Project Flow tracks: a Linear project, a GitHub project, or a GitHub repo whose tickets are in no GitHub project.
_Avoid_: Board, repo (when a project is meant)

**Found project**:
A project that Project Flow finds from tracker membership, with no configuration entry. On Linear, Lev is a member or the lead. On GitHub, Lev owns the project, or he owns or collaborates on the repo.
_Avoid_: Discovered project, membership project

**Pinned project**:
A project that the configuration names so that it always shows.
_Avoid_: Favorite, starred

**Hidden project**:
A project that the configuration names so that it never shows.
_Avoid_: Ignored, muted, archived

**Activity window**:
The number of days in the configuration. A found project shows when it has an open ticket and activity inside this window.
_Avoid_: Stale window, quiet period

**Ticket**:
One unit of tracked work: a GitHub issue or a Linear issue.
_Avoid_: Issue, task, item

**Unlinked PR**:
An open PR that links to no ticket, through a closing reference, a tracker attachment, or its branch name.
_Avoid_: Orphan PR, loose PR

**Tracker**:
The external system that owns a ticket: GitHub or Linear.
_Avoid_: Source, provider, tool

### Grouping

**Workstream**:
The top group in a project map: on GitHub the root epic, else the milestone; on Linear the project milestone.
_Avoid_: Area, epic, feature area

**Theme**:
The group inside a workstream: the epic or top parent ticket, else the scope in the ticket title (`feat(ux): ...`).
_Avoid_: Category, scope group

### State

**State**:
The place of a ticket in its workflow. The tracker status sets the state. GitHub evidence and workcell evidence move the state forward. Missing evidence never moves the state back. Done and Dropped come from the tracker. A merged PR that closes the ticket also sets Done.
_Avoid_: Status (when the state is meant), column

**Lane**:
The column a ticket sits in on a project board. The lane matches the ticket's state. The tracker sets the lanes, in tracker order and tracker colours. The app adds an Awaiting merge lane when the tracker has none.
_Avoid_: Column, status column

**Blocked**:
A flag on a ticket in any state. The ticket has at least one open blocker. The ticket stays in the lane of its state.
_Avoid_: Blocked state

**Stale status**:
A chip that names the tracker status when that status lags the state.
_Avoid_: Stale, out of date, wrong status

**Run failed**:
A chip on a ticket whose workcell run failed or stalled. The ticket returns to the lane of its tracker status.
_Avoid_: Failed, error, stalled

**Done**:
A closed ticket that was completed.

**Dropped**:
A closed ticket that was cancelled or closed as not planned.
_Avoid_: Cancelled, won't do

**In progress**:
An open ticket whose state has moved forward on a live workcell run, a pushed branch, a started devkit todo, or a draft PR.
_Avoid_: Started, active

**In review**:
An open ticket whose least advanced open PR is out of draft and has a review cycle that has begun but not finished. The review cycle is the workcell run's review rounds when a run exists, else the expected review bots.
_Avoid_: Under review, PR open

**Awaiting merge**:
An open ticket whose every open PR has finished its review cycle and waits for a human to merge it. Auto-merge is off, or auto-merge is set to ask.
_Avoid_: Ready, pending merge, mergeable

**Backlog**:
An open ticket that has not moved forward from its tracker status, and whose tracker status is the start of the workflow.
_Avoid_: Todo, not started

**Blocker**:
An open ticket that another ticket depends on.

**Cross-project blocker**:
A blocker that belongs to a different project than the ticket it blocks.
_Avoid_: External blocker, outside dependency

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
A ticket or PR that only Lev can move: it has an open ask addressed to Lev, it is awaiting merge, or it carries a need-human or need-engineer label with Lev as assignee.
_Avoid_: Waits on you, waits on Lev, needs Lev

**Ask**:
A question that an agent posts on a ticket or PR with an ask marker. It stays open until a later comment or the progress comment answers it.
_Avoid_: Question, request, final report (when the ask is meant)

**Senior**:
The agent that answers asks before they reach Lev. A project with no senior sends every ask to Lev.
_Avoid_: Reviewer, PM

**Answered**:
A needs-you item that Lev replied to after its latest ask.

**Acknowledged**:
An answered item where an agent reacted to Lev's reply.
_Avoid_: Seen, read

**Notification**:
An event the browser shows when a configured trigger fires: a new needs-you item, a new comment, or a cleared cross-project blocker.

**Inbox**:
The list of every notification Project Flow has raised.
