# Side panel layout and Esc

Each walk serves recorded tracker responses. The server sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The walks click, then a shot records the page. The verifier presses Esc in place of that click and checks that only the named layer closes.

Item 1 and item 2, Needs you panel, light then dark. Replay `proof/walk-307-needs-light.json`. The Comment label is in both shots. `needs-menu-open` is the open project menu. Press Esc there: the menu closes and the panel stays. `needs-esc-closed` stands in for Esc on the open panel: the panel closes and focus returns to the row.

Item 1 and item 3, board ticket panel, light then dark. Replay `proof/walk-307-board.json`. `board-menu-open` is the open filter menu. Press Esc there: the menu closes and the panel stays. `board-esc-closed` stands in for Esc on the open panel: the panel closes and focus returns to the card.

Item 4, Inbox panel and the jump box. Replay `proof/walk-307-inbox.json`. `inbox-jump-open` is the open jump box. Press Esc there: the box closes and the panel stays. `inbox-esc-closed` stands in for Esc on the open panel: the panel closes and focus returns to the row.

Item 5, the style diff. `git diff -- src/ui-styles.ts src/panel.tsx src/tokens.stylex.ts` adds no `px` or `rem` literal.
