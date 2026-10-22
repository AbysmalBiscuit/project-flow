# Parent ticket group walk

`walk-350-item-3.json` shows that the project graph puts #97 inside the group of its sub-tickets.

- `project-flow-97.json` holds responses recorded from `AbysmalBiscuit/project-flow`: #97, its sub-issues, the open issues and each issue's `blocked_by` list.
- The recording keeps #97 open, as it was when the issue was filed. The graph hides a done ticket that no blocker link touches, and #97 has no blocker links.
- The `/check` page frames the project graph. It names each group box that holds the #97 card and counts the other cards in that box.

Replay the walk:

```bash
workcell walk-replay --walk-file proof/walk-350-item-3.json --proof .devkit/proof --item 3
```
