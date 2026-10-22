# Closed ticket in Done

The walk serves recorded tracker responses through `proof/serve-281.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The issue response is the recorded #205 body, closed as completed. The pull response is the recorded #206 body, merged, with `Closes #205` in the body. The clock is 2026-10-22 so the Done age cap still shows the card.

Replay `proof/walk-281.json`:

```bash
workcell walk-replay --walk-file proof/walk-281.json --proof .devkit/proof --item 2
```

The Done lane holds #205. The card title is the recorded #205 title.
