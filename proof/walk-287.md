# Graph status and edge contrast

The walks serve recorded tracker responses through `proof/serve-graph-status.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

`acme/widget#2` is open. `acme/widget#8` is done and reaches the graph only through the closed link on `#2`. `acme/widget#5` is open and blocks `#3`. `acme/gate#4` is a done ticket in another project and blocks `#5`. The filtered ticket list holds the open tickets only. The graph probe `#graph-states` names each shown ticket and its state.

Item 1, state borders in the light theme. Replay `proof/walk-287-states-light.json`:

```bash
workcell walk-replay --walk-file proof/walk-287-states-light.json --proof .devkit/proof --item 1
```

The shot shows `#2` and `#5` with the backlog border, `#8` with the done border, and `acme/gate#4` with the done border. The solid edge matches the solid swatch. The dashed edge matches the dashed swatch.

Item 1, the same graph in the dark theme. Replay `proof/walk-287-states-dark.json`:

```bash
workcell walk-replay --walk-file proof/walk-287-states-dark.json --proof .devkit/proof --item 1
```

Item 3, edge contrast in the light theme. Replay `proof/walk-287-contrast-light.json`:

```bash
workcell walk-replay --walk-file proof/walk-287-contrast-light.json --proof .devkit/proof --item 3
```

The page does not carry a contrast calculator. After the walk shows the legend, run `proof/graph-contrast.mjs` in the page:

```bash
agent-browser eval --stdin < proof/graph-contrast.mjs
```

The script reads the computed colour of `#project-graph` and the computed colours of the legend swatches. It computes each ratio itself. Each ratio is at least 3. It also reads each drawn arrowhead fill. A missing swatch, a ratio under 3, or an arrowhead of the other edge colour throws. Replay the same script after the dark walk.

Light canvas `rgb(255, 255, 255)`. Solid edge and solid arrowhead `rgb(89, 89, 89)`, ratio 7.00. Dashed edge and dashed arrowhead `rgb(31, 111, 138)`, ratio 5.68.

Item 3, the same edges in the dark theme. Replay `proof/walk-287-contrast-dark.json`:

```bash
workcell walk-replay --walk-file proof/walk-287-contrast-dark.json --proof .devkit/proof --item 3
```

Dark canvas `rgb(22, 22, 26)`. Solid edge and solid arrowhead `rgb(199, 199, 199)`, ratio 10.67. Dashed edge and dashed arrowhead `rgb(126, 200, 227)`, ratio 9.67.

The overview graph uses the same edge tokens. Its canvas is `colours.surface`. Light surface `rgb(255, 255, 255)` gives the same solid ratio, 7.00. Dark surface `rgb(17, 17, 17)` gives solid `rgb(199, 199, 199)` at 11.48. The overview draws no done edge.

Item 4, legend swatches. Replay `proof/walk-287-legend.json`:

```bash
workcell walk-replay --walk-file proof/walk-287-legend.json --proof .devkit/proof --item 4
```

The solid swatch uses the solid edge colour. The dashed swatch uses the dashed edge colour and the same dash length. A done edge ends in an arrowhead of the done-edge colour. The legend swatch for that edge uses the same colour.

DECIDED: the solid edge and the arrowhead share the `graphEdge` token. The dashed edge and its arrowhead share the `graphEdgeDone` token. Both tokens are graph-only.

DECIDED: overview graph edges and arrowheads use the project graph edge tokens. The overview edge stroke and marker use `graphEdge`. A done overview edge uses `graphEdgeDone`. The change stays inside both graphs.

DECIDED: a done ticket in another project takes its state from that project's report when the report is loaded. The recorded walk includes that ticket.
