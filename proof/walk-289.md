# Graph float walks

The walks serve recorded tracker responses through `proof/serve-graph-status.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The project page opens on the graph. `#project-graph-layout` names three facts: `canvas-flush` when the canvas top and bottom match the pane, `floats-apart` when the legend and the controls do not cover each other, and `page-fits` when `scrollWidth` equals `clientWidth`.

`walk_replay` pins 1280 by 800. A walk file name is a label. It is not a viewport the walk runs at.

Item 1, the legend over the top-left of the canvas. Replay `proof/walk-289-float.json`:

```bash
workcell walk-replay --walk-file proof/walk-289-float.json --proof .devkit/proof --item 1
```

The layout line reads `canvas-flush floats-apart page-fits`. The shot shows the legend over the top-left of the canvas. The canvas starts at the pane top.

Item 2, the direction switch and the zoom controls. Replay `proof/walk-289-controls.json`:

```bash
workcell walk-replay --walk-file proof/walk-289-controls.json --proof .devkit/proof --item 2
```

The shot shows Left to right, Top to bottom, minus, Fit and plus over the top-right of the canvas. The page toolbar holds Filter, Search, Group by, and the view switch.

Item 3, the floating parts still work. Replay `proof/walk-289-actions.json`:

```bash
workcell walk-replay --walk-file proof/walk-289-actions.json --proof .devkit/proof --item 3
```

The direction probe reads `top-to-bottom` after the click. Zoom in writes `zoom 1.2`. Fit writes `zoom 1.487`. The walk runner has click, fill, assert_text and shot. It has no drag step. A drag on the open canvas still pans it. The drag check is in `.devkit/proof/289-browser-walk.log`.

Item 4, the phone width. Replay `proof/walk-289-phone.json`. That file name is a label. `walk_replay` does not run it at 390:

```bash
workcell walk-replay --walk-file proof/walk-289-phone.json --proof .devkit/proof --item 4
```

At 390 the legend stays top-left and the controls stay top-right. They do not cover each other. `page-fits` means `scrollWidth` equals `clientWidth`.

Item 5, the style change uses StyleX variables. The diff of `src/ui-styles.ts` and `src/tokens.stylex.ts` is the proof.
