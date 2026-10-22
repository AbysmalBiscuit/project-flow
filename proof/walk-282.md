# Board card lanes

Each walk serves recorded tracker responses through `proof/serve-card-lanes.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The board is `Widget board`. Backlog holds `Park the board card` and `Hold the launch window`. `Hold the launch window` is blocked by `#2`. Ready holds `Queue the board card`, `Open the gate` and `Pick the card colour`. `Pick the card colour` has an open ask, so its card shows `Needs you`. In progress holds `Build the lane tint`. In review holds `Read the review comments`. Awaiting merge holds `Wait for the merge`. Dropped holds `Drop the unused card`. Done holds six closed tickets, so `Show all` sits under the Done title and above the cards.

Item 1, light and dark themes. Replay `proof/walk-282-light.json` for the light theme. The server starts in the light theme. The walk clicks `Frame left lanes`, then `Frame lanes`. Those controls are in the proof server, not the shipped page. `Frame left lanes` scrolls the lanes row to the left edge. The left shot shows the Backlog card and a lane-colour border on each card in Backlog, Ready, In progress and In review. `Frame lanes` scrolls the Dropped card into the lanes frame. The right shot shows a lane-colour border on each card in In review, Awaiting merge, Done and Dropped. Replay `proof/walk-282-dark.json` for the dark theme. Its serve command passes `dark`. The left shot and the right shot show the same borders in the dark tokens.

```
workcell walk-replay --walk-file proof/walk-282-light.json --proof .devkit/proof --item 1
```

```
workcell walk-replay --walk-file proof/walk-282-dark.json --proof .devkit/proof --item 1
```

Item 2, blocked Backlog. Replay `proof/walk-282-blocked.json`. The walk passes `frame=acme/widget#3`. The proof server frames that card. The shot shows the card in the Backlog lane, with the Backlog border and a `Blocked by #2` chip.

```
workcell walk-replay --walk-file proof/walk-282-blocked.json --proof .devkit/proof --item 2
```

Item 3, Needs you. Replay `proof/walk-282-needs.json`. The walk passes `frame=acme/widget#4`. The proof server frames that card. The shot shows a white `Needs you` pill at the bottom of `Pick the card colour`.

```
workcell walk-replay --walk-file proof/walk-282-needs.json --proof .devkit/proof --item 3
```

Item 4, Show all. Replay `proof/walk-282-show-all.json`. The walk passes `frame=acme/widget#10`. The proof server frames that card. The shot shows `Show all` under the Done title and above the Done cards.

```
workcell walk-replay --walk-file proof/walk-282-show-all.json --proof .devkit/proof --item 4
```
