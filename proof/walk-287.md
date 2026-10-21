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

`#edge-contrast` names the canvas colour and the solid, dashed and marker colours with each ratio. Each ratio is at least 3.

Item 3, the same edges in the dark theme. Replay `proof/walk-287-contrast-dark.json`:

```bash
workcell walk-replay --walk-file proof/walk-287-contrast-dark.json --proof .devkit/proof --item 3
```

Item 4, legend swatches. Replay `proof/walk-287-legend.json`:

```bash
workcell walk-replay --walk-file proof/walk-287-legend.json --proof .devkit/proof --item 4
```

The solid swatch uses the solid edge colour. The dashed swatch uses the dashed edge colour and the same dash length.

DECIDED: the solid edge and the arrowhead share one graph token. The dashed edge uses a second graph token, so the two edges stay distinct. Both tokens are graph-only.

DECIDED: a done ticket in another project takes its state from that project's report when the report is loaded. The recorded walk includes that ticket.
