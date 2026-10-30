# Merge through the forge

Project Flow merges a PR through the `merge` capability of the PR's forge, with Lev's token. It never merges through a factory. Project Flow checks its own merge gate first: every check has finished, no check failed, and the PR has no open Important Question.

## Considered options

- Post an approval comment, so that the workcell hub starts a merge run with the workcell merge gates. This works only for a GitHub PR of a hub source. The merge comes on a later hub pass, and the hub reads approval through text matching.
- A new factory route that runs the workcell merge stage. This needs a workcell change and covers only workcell PRs.

## Consequences

- Merge works on every PR in Awaiting merge whose forge has the `merge` capability, also when no factory runs.
- The workcell merge gates do not run. Project Flow applies its own gate, and the forge applies its branch rules.
- The hub finds a merge outside workcell on its next poll. It moves the ticket and frees the run's worktree.
- Project Flow does not close the ticket and does not delete the branch. A closing reference, the tracker's integration and the repo setting do that.
- A forge with a merge queue needs its adapter to add the PR to the queue, not merge it directly.
- Request changes follows the same rule: a review through the forge. A factory acts on the review through its own triggers.
