# Phone gutter walks

Both walks serve recorded tracker responses through `proof/serve-title-row.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker. The needs-you page on this fixture shows an empty list.

Item 1, at 390 wide. Replay `proof/gutter-walk-390.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/gutter-walk-390.json --proof .devkit/proof --item 1
```

The overview, project board and needs-you shots use a side gutter of at most 16px. The page does not scroll sideways. The board lanes scroll inside the page.

Item 2, at 1440 wide. Replay `proof/gutter-walk-1440.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/gutter-walk-1440.json --proof .devkit/proof --item 2
```

The overview shot keeps the desktop side gutter.
