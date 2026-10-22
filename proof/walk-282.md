# Board card lanes

Each walk serves recorded tracker responses through `proof/serve-card-lanes.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The board is `acme/widget`. The ready lane holds `Queue the board card`, `Hold the launch window` and `Pick the card colour`. `Hold the launch window` is blocked by `#2`. `Pick the card colour` has an open ask, so its card shows `Needs you`. The factory running lane holds `Build the lane tint`. The factory in-review lane holds `Read the review comments`. Done holds six closed tickets, so `Show all` sits under the Done title and above the cards.

Item 1, light and dark themes. Replay `proof/walk-282-light.json` for the light theme. The server starts in the light theme. The shot shows a lane-colour border on each card. Replay `proof/walk-282-dark.json` for the dark theme. Its serve command passes `dark`. The shot shows the same borders in the dark tokens.

```
workcell walk-replay --walk-file proof/walk-282-light.json --proof .devkit/proof --item 1
```

```
workcell walk-replay --walk-file proof/walk-282-dark.json --proof .devkit/proof --item 1
```

Item 2, blocked Backlog. Replay `proof/walk-282-blocked.json`. The shot shows `Blocked by #2` on the Backlog card. That card keeps the Backlog border.

```
workcell walk-replay --walk-file proof/walk-282-blocked.json --proof .devkit/proof --item 2
```

Item 3, Needs you. Replay `proof/walk-282-needs.json`. The shot shows a white `Needs you` pill at the bottom of `Pick the card colour`.

```
workcell walk-replay --walk-file proof/walk-282-needs.json --proof .devkit/proof --item 3
```

Item 4, Show all. Replay `proof/walk-282-show-all.json`. The shot shows `Show all` under the Done title and above the Done cards.

```
workcell walk-replay --walk-file proof/walk-282-show-all.json --proof .devkit/proof --item 4
```
