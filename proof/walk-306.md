# Capped lane Show all

Each walk serves recorded tracker responses through `proof/serve-show-all.ts`. That script starts `proof/serve-card-lanes.ts` and sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The board is `Widget board`. Done holds six closed tickets, so the lane is capped. `Show all` sits in the Done header, after the status name and the count. The button is not at the foot of the lane.

`workcell walk-replay` pins 1280 by 800. A walk file name is a label. It is not a viewport the walk runs at. The 390 shot loads the app in an iframe 390 wide. The iframe width is a proof harness length.

Item 1, header placement. Replay `proof/walk-306-header.json`:

```bash
workcell walk-replay --walk-file proof/walk-306-header.json --proof .devkit/proof --item 1
```

The walk opens the board, frames the Done lane and takes `done-header`. The shot shows `Show all` in the Done header row, after `DONE` and the count. The button is not under the cards.

Item 2, reveal. Replay `proof/walk-306-reveal.json`:

```bash
workcell walk-replay --walk-file proof/walk-306-reveal.json --proof .devkit/proof --item 2
```

The before shot is item 1, `done-header`. This walk opens the board with `frame=acme/widget#15` and clicks `[data-show-all="Done"]` before it frames the lane. The frame click clones the live lane, so it must follow the reveal. The walk asserts `Close item 6`, then frames that card. The after shot, `after-show-all`, shows `Close item 6` in the Done lane. The header no longer shows `Show all`.

Item 3, one line at desktop and at 390. Replay `proof/walk-306-desktop.json`, then `proof/walk-306-390.json`:

```bash
workcell walk-replay --walk-file proof/walk-306-desktop.json --proof .devkit/proof --item 3
```

```bash
workcell walk-replay --walk-file proof/walk-306-390.json --proof .devkit/proof --item 3
```

The desktop shot shows the Done title on one line with `Show all` in that row. The phone walk loads `/proof/show-all-390`. The page writes `title one line` and `show all in header` when the Done title stays one line and the button shares that row. The shot shows the 390 iframe.

Item 4, styles. The button uses `shell.button` and `board.showAll`. Those styles take `space`, `type` and `measure` variables. The diff adds no `px` or `rem` literal.

DECIDED: the lane name ellipsizes when the header is tight, so `Show all` stays on the title line at 390. A long tracker status keeps its full name in the lane `aria-label`.
