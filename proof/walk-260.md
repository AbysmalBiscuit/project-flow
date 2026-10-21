# Overview card walks

Each walk serves recorded tracker responses through `proof/serve-cards.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The overview has three projects. `acme/short` lists six cross-project blockers, `acme/tall#1` through `acme/tall#6`. `acme/tall` and `acme/empty` list none.

`walk_replay` pins 1280x800. A walk file name is a label. It is not a viewport the walk runs at.

Item 1, equal card height. Replay `proof/walk-260-heights.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-260-heights.json --proof .devkit/proof --item 1
```

Measure each `li[id^=project-card]` height. The three heights are equal. `acme/short` shows `+5 more`.

Item 2, the overflow chip. Replay `proof/walk-260-more.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-260-more.json --proof .devkit/proof --item 2
```

A click on `[data-more]` opens `/projects/acme%2Fshort`. The page shows `Wait on six tickets`.

Item 3, the phone width. Replay `proof/walk-260-390.json`. That file name is a label. `walk_replay` does not run it at 390:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-260-390.json --proof .devkit/proof --item 3
```

At 390 wide, each card height matches the height from item 1. `document.documentElement.scrollWidth` equals `document.documentElement.clientWidth`.
