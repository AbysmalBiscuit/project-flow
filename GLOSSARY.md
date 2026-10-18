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

**Done**:
A closed ticket that was completed.

**Dropped**:
A closed ticket that was cancelled or closed as not planned.
_Avoid_: Cancelled, won't do

**Blocked**:
An open ticket with at least one open blocker.

**In progress**:
An open, unblocked ticket with a pushed branch, a started devkit todo, or a draft PR, and no open PR ready for review. The tracker's own status does not count.
_Avoid_: Started, active

**In review**:
An open, unblocked ticket whose least advanced open PR is out of draft and has a review cycle that has begun but not finished. The review cycle is the workcell run's review rounds when a run exists, else the expected review bots.
_Avoid_: Under review, PR open

**Awaiting merge**:
An open, unblocked ticket whose every open PR has finished its review cycle and waits for a human to approve and merge it.
_Avoid_: Ready, pending merge, mergeable

**Backlog**:
An open ticket that is neither blocked nor in progress.
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
