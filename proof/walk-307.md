# Side panel layout and Esc

Each app walk serves recorded tracker responses. The server sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The walk format has no key press. `workcell walk-replay` accepts `goto`, `click`, `fill`, `assert_text` and `shot`. A fill of `#walk-esc` is the Escape step that format accepts. The fill dispatches one Escape `keydown`. The same event reaches the capture listener on `window` and, when that listener does not mark it handled, the listeners on `document`.

Item 1, a Needs you panel in the light theme and the dark theme. Replay `proof/walk-307-needs-light.json`:

```bash
workcell walk-replay --walk-file proof/walk-307-needs-light.json --proof .devkit/proof --item 1
```

`needs-panel-light` and `needs-panel-dark` show the loading note or the loaded thread, the title, the state, `WHY THIS NEEDS YOU`, the PR, CI and Review rows, and the reply form. Each section shares the header inset. The walk asserts the rendered heading `WHY THIS NEEDS YOU` and the rendered theme name `Dark`.

Item 1, a board ticket panel in the light theme and the dark theme. Replay `proof/walk-307-board.json`:

```bash
workcell walk-replay --walk-file proof/walk-307-board.json --proof .devkit/proof --item 1
```

`board-panel-light` and `board-panel-dark` show the same inset on the title, the state, the comments and the reply form.

Item 2, the one heading style and the one label and value grid. The same Needs you replay writes `needs-panel-light`. The heading reads `WHY THIS NEEDS YOU`. The rows read `PR`, `CI` and `Review`, each label beside its value. That is the approved mockup side panel in `/home/lev/project-flow-mockups/NeedsYou-light.png`. Place the shot beside that file. The walk format serves one origin, so the comparison file stays outside the replay.

Item 3, the Comment label. The same Needs you replay writes `needs-comment-light` and `needs-comment-dark`. The same board replay writes `board-comment-light` and `board-comment-dark`. Each shot frames the Comment button. The label reads Comment in both themes.

Item 4, Escape. The walk format has no key press, so each walk fills `#walk-esc`. That fill is the Escape press.

Needs you, in `proof/walk-307-needs-light.json`. `needs-menu-open` is the open project menu. The next `#walk-esc` fill closes only that menu. `needs-menu-esc` still shows `WHY THIS NEEDS YOU`. The following `#walk-esc` fill closes the panel. `needs-esc-focus` shows focus on the row that opened it.

Project page, in `proof/walk-307-board.json`. `board-menu-open` is the open filter menu. The next `#walk-esc` fill closes only that menu. `board-menu-esc` still shows the panel. The following `#walk-esc` fill closes the panel. `board-esc-focus` shows focus on the card that opened it.

Inbox, in `proof/walk-307-inbox.json`. The jump box opens from the visible Search tickets button. `inbox-jump-open` is that box. The next `#walk-esc` fill closes only the box. `inbox-jump-esc` still shows the panel. The following `#walk-esc` fill closes the panel. `inbox-esc-focus` shows focus on the row that opened it.

Item 5, the style diff. `git diff 6457226 -- src/ui-styles.ts src/panel.tsx src/tokens.stylex.ts src/global.css` adds no `px` or `rem` literal.
