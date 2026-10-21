# Board lane walks

Each walk serves recorded tracker responses through `proof/serve-lane-width.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The board is `acme/widget`. It has five lanes: ready, factory: running, factory: in-review, Awaiting merge and Done. Awaiting merge is empty. Done holds one card, "Merge the board after the last review round".

`walk_replay` pins 1280x800. A walk file name is a label. It is not a viewport the walk runs at. The widths in the Done when are proved by a separate measurement the verifier records.

The lane frame draws its edge with an inset `boxShadow` of `measure.hairline` and `colours.laneLine`. The shadow takes no layout width. `borderWidth` on that frame is `0`.

Path B captures the same recorded board with agent-browser. `XDG_DATA_HOME` is a temporary folder. The server is `proof/serve-lane-width.ts`. Shots stay under `.devkit/proof/` and are not committed.

At 1440 every `[data-lane]` offsetWidth is 256. The empty Awaiting merge lane is 256. The frame clientWidth is 1280. The five lanes sum to 1280. `document.documentElement` scrollWidth is 1440 and clientWidth is 1440. Shot: `.devkit/proof/lanes-1440.png`.

At 2000 every `[data-lane]` offsetWidth is 256, including Awaiting merge. The frame clientWidth is 1280. The five lanes sum to 1280. `document.documentElement` scrollWidth is 2000 and clientWidth is 2000. Shot: `.devkit/proof/lanes-2000.png`.

The Done card title at 2000 reads on two lines: "Merge the board after the last" and "review round". No line is one word. Shot: `.devkit/proof/done-title-2000.png`.

At 390 `document.documentElement` scrollWidth is 390 and clientWidth is 390. The frame scrollWidth is 1280 and its clientWidth is 358. Setting `scrollLeft` to 120 leaves `scrollLeft` at 120. Shot: `.devkit/proof/board-390.png`.

Item 1, equal lanes, including the empty lane. Replay `proof/lane-walk-1440.json`. That file name is a label. `walk_replay` does not run it at 1440:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/lane-walk-1440.json --proof .devkit/proof --item 1
```

Every lane has the same width. The empty Awaiting merge lane is as wide as a lane that holds a card.

Item 2, Done titles. Replay `proof/lane-walk-done.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/lane-walk-done.json --proof .devkit/proof --item 2
```

The Done card shows its title across the lane. No line of the title is one word.

Item 3, the board scrolls inside its frame. Replay `proof/lane-walk-390.json`. That file name is a label. `walk_replay` does not run it at 390:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/lane-walk-390.json --proof .devkit/proof --item 3
```

The board scrolls sideways inside its frame. The page does not scroll sideways: `document.documentElement.scrollWidth` equals `document.documentElement.clientWidth`.

Item 4 is `bun run lint`. It checks that the lane width is the `measure.lane` token and that no new colour, `px` or `rem` literal sits outside the tokens.
