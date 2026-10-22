# Expand the side panel

Each app walk serves recorded tracker responses. The server sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The walk format has no key press. `workcell walk-replay` accepts `goto`, `click`, `fill`, `assert_text` and `shot`. A fill of `#walk-esc` is the Escape step that format accepts. The fill dispatches one Escape `keydown`. The same event reaches the listener on `document`.

The expand button shows `Expand` and carries the accessible label `Expand panel`. A click sets `data-expanded="true"`. The button then shows `Collapse` and carries the accessible label `Collapse panel`. The expanded panel covers the board, graph or table area and the side panel area. Needs you and Inbox use the same button over their list area. A phone width uses the same overlay. The panel already fills the screen there, so the overlay covers that same area.

Expanded state stays in the open panel. A ticket change, a reload or a close drops it.

Item 1, Board, Graph and Table. Replay `proof/walk-311-views.json`:

```bash
workcell walk-replay --walk-file proof/walk-311-views.json --proof .devkit/proof --item 1
```

`board-side` shows the side panel and the board. `board-expanded` shows the panel over the board area. `graph-expanded` shows the panel over the graph area. The ticket opens from the board, then the walk switches to Graph. `table-expanded` shows the panel over the table area.

Item 2, collapse and Escape. The same replay writes `board-collapsed` after a click on `Collapse panel`. The panel returns to its side width and the board stays open. `board-esc-collapsed` follows one `#walk-esc` fill from the expanded panel. `board-esc-closed` follows a second `#walk-esc` fill. The panel is gone and the board remains.

Item 3, a wide table. Replay `proof/walk-311-wide.json`:

```bash
workcell walk-replay --walk-file proof/walk-311-wide.json --proof .devkit/proof --item 3
```

The recorded comment on `Wide comment` holds the cell `WIDETABLE_abcdefghijklmnopqrstuvwxyz0123456789_abcdefghijklmnopqrstuvwxyz_END`. `wide-side` shows that cell in the side panel. `wide-expanded` shows the same cell in the expanded panel, with no horizontal scroll on the comment table.

Item 4, the view under the panel. Replay `proof/walk-311-keep.json`:

```bash
workcell walk-replay --walk-file proof/walk-311-keep.json --proof .devkit/proof --item 4
```

`keep-before` shows the table and the selected row. `keep-expanded` covers that view. `keep-after` shows the same selected row after collapse. `keep-graph` shows the graph after a zoom and a collapse. The ticket stays open and the zoom tools stay on the page.

The graph tools print the viewport as `zoom <scale> at <x>,<y>` in a hidden probe. The walk asserts that text after `Zoom in` and again after the collapse. The values hold for the replay viewport of 1280 by 800.

The walk format has no scroll step. `proof/measure-scroll-311.mjs` sets the board lane scroller to 200 and the table scroller to 33, expands, collapses, and writes `.devkit/proof/walk-311-scroll.log`. That folder is gitignored. Do not commit the log.

```bash
bun proof/measure-scroll-311.mjs
```

Item 5, Needs you and Inbox. Replay `proof/walk-311-lists.json`:

```bash
workcell walk-replay --walk-file proof/walk-311-lists.json --proof .devkit/proof --item 5
```

`needs-expanded` shows the panel over the Needs you list. `inbox-expanded` shows the panel over the Inbox list.

Item 6, the style diff. `git diff origin/main -- src/ui-styles.ts src/panel.tsx src/tokens.stylex.ts src/terms.ts` adds no `px` or `rem` literal.
