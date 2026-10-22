# Closed ticket in Done

The walk serves recorded tracker responses through `proof/serve-281.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The first poll returns the recorded #205 body as an open issue with status In review, and the recorded #206 body as an open pull with `Closes #205`. The second poll returns the same #205 body closed as completed, with project status Done, and the same #206 body merged. The clock is 2026-10-22 so the Done age cap still shows the card.

Replay `proof/walk-281.json`:

```bash
workcell walk-replay --walk-file proof/walk-281.json --proof .devkit/proof --item 2
```

The board shows #205 in In review after the first poll. Refresh on the overview starts the second poll. The board then shows #205 in the Done lane. The card title is the recorded #205 title. The proof clock follows real time from 2026-10-22T00:00:00Z, so a refresh after the minimum poll gap reads the trackers again.
