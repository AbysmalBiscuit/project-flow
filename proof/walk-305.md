# Overview header height

The walks serve recorded tracker responses through `proof/serve-header-height.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker. The script stubs `Notification.permission` as `default`, so the Overview header shows Allow notifications.

`proof/serve-header-height.ts` writes each control's height and a per-row tops-equal yes or no as visible page text. It does not write an absolute top. The desktop page writes the overview line, then the project page line. The phone walk serves a same-origin wrapper. The wrapper loads the app in an iframe 390px wide, so the phone media queries run inside the iframe. The wrapper copies each row's heights, that row's tops-equal line and `scrollWidth` into its own visible text. A row groups controls whose tops differ by at most 1px. The measure writes that text only when the line differs, so the observer does not loop. The iframe width is a proof harness length.

Item 1, desktop height. Replay `proof/walk-305-desktop.json`:

```bash
workcell walk-replay --walk-file proof/walk-305-desktop.json --proof .devkit/proof --item 1
```

The overview shot shows the project search, the Cards/Graph/Table switch, the refresh button and Allow notifications. The asserted line names each control's height and tops-equal yes. The project shot shows the filter, the project search, Group by and the Board/Graph/Table switch. That asserted line names those heights and tops-equal yes. The shared height is `measure.headerControl`.

Item 3, phone width. Replay `proof/walk-305-phone.json`:

```bash
workcell walk-replay --walk-file proof/walk-305-phone.json --proof .devkit/proof --item 3
```

The shot shows the 390px iframe. The search sits on its own line. The view switch, the refresh button and Allow notifications share the next line. The asserted line names each row's heights, tops-equal yes for that row and `scrollWidth`. The glyphs stay at `measure.glyph`. A focused control keeps the shared focus ring.

DECIDED: the shared height is `measure.headerControl`. `measure.toggle` is the same value, so the refresh button keeps its touch target and the focus ring stays outside the border.
