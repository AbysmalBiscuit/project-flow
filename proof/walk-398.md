# One state tone in every view

The walks serve recorded tracker responses through `proof/serve-398.ts`. That script starts `proof/serve-card-lanes.ts`, which sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

`proof/serve-398.ts` adds a `Probe tones` button to the page. The button writes one line for each view, state and computed colour into `#tone-probe`. Each walk asserts the same colour for one state in each view on its page.

Item 1, light theme. Replay the board walk and the overview walk:

```bash
workcell walk-replay --walk-file proof/walk-398-light-board.json --proof .devkit/proof --item 1
workcell walk-replay --walk-file proof/walk-398-light-overview.json --proof .devkit/proof --item 1
```

The board shot shows the lane marks and the card borders. The graph shot shows the graph nodes and the legend. The overview shot shows the progress bar and the count legend.

Item 1, dark theme. Replay `proof/walk-398-dark-board.json` and `proof/walk-398-dark-overview.json` the same way. The serve command passes `dark`.
