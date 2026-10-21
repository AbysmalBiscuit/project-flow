# Project graph height

`proof/graph-height.mjs` is the proof. The verifier runs that script. A walk names the script and the viewport. `workcell walk-replay` pins 1280 by 800, so a walk cannot set these sizes.

The script starts `proof/serve-graph-edges.ts`. That server sets `XDG_DATA_HOME` to a temporary folder and serves recorded tracker responses. It never calls a live tracker. Shots go under `.devkit/proof/` and stay uncommitted.

```
bun proof/graph-height.mjs
```

The script opens `/projects/acme%2Fwidget` at three viewports and writes one shot each.

Item 1, tall window. Viewport 1440 by 1300. Walk `proof/walk-256-tall.json`. Shot `.devkit/proof/graph-1440x1300.png`.

The `#project-graph` pane ends at the window bottom less the page gutter. The gutter is the page `paddingBottom`, `space.threeXl`.

Item 1, short window. Viewport 1440 by 800. Walk `proof/walk-256-short.json`. Shot `.devkit/proof/graph-1440x800.png`.

The pane ends on the same gutter. `minHeight` stays `boardMin` (36rem). The floor does not push the pane past that edge.

Item 2, phone width. Viewport 390 wide by 1200. Walk `proof/walk-256-phone.json`. Shot `.devkit/proof/graph-390.png`.

The pane keeps the `boardMin` height. `documentElement.scrollWidth` stays at the viewport width.
