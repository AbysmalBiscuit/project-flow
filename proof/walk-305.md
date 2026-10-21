# Overview header height

The walks serve recorded tracker responses through `proof/serve-header-height.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker. The script stubs `Notification.permission` as `default`, so the Overview header shows Allow notifications.

Item 1, desktop height. Replay `proof/walk-305-desktop.json`:

```bash
workcell walk-replay --walk-file proof/walk-305-desktop.json --proof .devkit/proof --item 1
```

The overview shot shows the project search, the Cards/Graph/Table switch, the refresh button and Allow notifications in one row. Each control is 36px tall and shares one top. The project shot shows the project search, the filter, Group by and the Board/Graph/Table switch. Each of those controls is 36px tall. 36px is `measure.headerControl`.

Item 3, phone width. The walk replay pins the browser at 1280 by 800. The server sets the page width to 390px and applies the phone gutter, so the header lays out as it does at 390px. Replay `proof/walk-305-phone.json`:

```bash
workcell walk-replay --walk-file proof/walk-305-phone.json --proof .devkit/proof --item 3
```

At 390px the search sits on its own line. The view switch, the refresh button and Allow notifications share the next line. Each control is 36px tall. The page does not scroll sideways. The glyphs stay 16px. A focused control keeps a 2px focus ring.

DECIDED: the shared height is `measure.headerControl` (2.25rem, 36px). `measure.toggle` is the same value, so the refresh button keeps its touch target and the focus ring stays outside the border.
