# Project graph height walks

Each walk serves recorded tracker responses through `proof/serve-graph-edges.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker. `acme/widget` opens in the graph view.

The replay pins one viewport in `proofshot.config.json` before `workcell walk-replay`. The implementer shots under `.devkit/proof/` are not the proof.

Item 1, tall window. Set the viewport to 1440 by 1300. Replay `proof/walk-256-tall.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-256-tall.json --proof .devkit/proof --item 1
```

The `#project-graph` pane ends at the bottom of the window less the page gutter (`space.threeXl`, 16px at the default root size).

Item 1, short window. Set the viewport to 1440 by 800. Replay `proof/walk-256-short.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-256-short.json --proof .devkit/proof --item 1
```

The same pane ends on the same gutter.

Item 2, phone width. Set the viewport to 390 by 844. Replay `proof/walk-256-phone.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-256-phone.json --proof .devkit/proof --item 2
```

`#project-graph` keeps the `boardMin` height (36rem). The page does not scroll sideways. When the header wraps, the page scrolls down to the pane.
