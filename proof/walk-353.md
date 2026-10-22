# Table hierarchy walks

The walks show the parent ticket rows of the Table when Group by is Workstream.

- `serve-353-app.ts` serves an `Initial SDI Issues` Linear project from a fake `fetch`. The tickets and the project slug are invented, because a proof run must not read a live tracker.
- The project has a three-level tree, a parent ticket whose sub-tickets are all done, a done sub-ticket with an open sub-ticket, and a ticket with no parent ticket.
- The `/rows` page frames the project table. It lists each row with its depth, and marks each parent ticket row `open` or `shut`. Text in its `#walk-search` box goes into the search box of the framed page.
- `walk-353-item-1.json` shows the rows at three depths, then collapses and expands `SDI-2`.
- `walk-353-item-2.json` shows that `SDI-6` starts collapsed and that `SDI-10` starts open, because its sub-ticket `SDI-11` has an open sub-ticket. It collapses `SDI-2` and reloads the table, and `SDI-2` stays collapsed. A search for `export` opens `SDI-2`, and a blank search collapses it again.
- The two walks use different ports, so each walk has its own browser storage.

Replay the walks:

```bash
workcell walk-replay --walk-file proof/walk-353-item-1.json --proof .devkit/proof --item 1
workcell walk-replay --walk-file proof/walk-353-item-2.json --proof .devkit/proof --item 2
```
