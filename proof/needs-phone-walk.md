# Phone walk

Replay `proof/needs-phone-walk.json` at 800 by 900.

`walk_replay.py` writes a 1280 by 800 viewport and ignores a viewport field. Pin 800 by 900 in `proofshot.config.json` before the session starts, then run:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/needs-phone-walk.json --proof .devkit/proof --item 1
```

The page serves recorded tracker responses from `bun scripts/proof-209.ts --port 4765`. Set `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

800px sits inside the 64rem phone rule. A 390px viewport clips the row behind the 5rem shell inset. The overview shots show the key and the headline. The Needs you shots show both on the open row.

The first Needs you shot is the dark theme. Name it `needs-phone-dark`. The shot after the theme toggle is the light theme. Name it `needs-phone-light`.
