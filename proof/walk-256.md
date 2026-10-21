# Project graph height

`proof/graph-height.mjs` is the proof. Run that script. It opens `/projects/acme%2Fwidget` at the three viewports and writes one shot each. The log is `.devkit/proof/graph-height.log`.

The script starts `proof/serve-graph-edges.ts`. That server sets `XDG_DATA_HOME` to a temporary folder and serves recorded tracker responses. It never calls a live tracker. Shots go under `.devkit/proof/` and stay uncommitted.

```
bun proof/graph-height.mjs
```

Item 1, tall window. Viewport 1440 by 1300. Shot `.devkit/proof/graph-1440x1300.png`.

The `#project-graph` pane ends at the window bottom less the page gutter. The gutter is `paddingBottom` on `frame.fill`, `space.lg`. The script measures that gutter at 16px.

Item 1, short window. Viewport 1440 by 800. Shot `.devkit/proof/graph-1440x800.png`.

The pane ends on the same gutter. `minHeight` stays `boardMin` (36rem). The floor does not push the pane past that edge.

Item 2, phone width. Viewport 390 wide by 1200. Shot `.devkit/proof/graph-390.png`.

The pane keeps the `boardMin` height. `documentElement.scrollWidth` stays at the viewport width.
