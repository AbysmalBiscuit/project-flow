# Board lane walks

Each walk serves recorded tracker responses through `proof/serve-lane-width.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The board is `acme/widget`. It has five lanes: ready, factory: running, factory: in-review, Awaiting merge and Done. Awaiting merge is empty. Done holds one card, "Merge the board after the last review round".

The replay opens the board at its own viewport, 1280 wide. Five lanes of `measure.lane` are wider than that frame, so the board scrolls inside the frame and the last lane is cut by the frame edge. The page does not scroll sideways. An empty lane matches a full one. The same token holds at 1440, at 2000 and at 390.

Item 1, equal lanes, including the empty lane. Replay `proof/lane-walk-1440.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/lane-walk-1440.json --proof .devkit/proof --item 1
```

Every lane has the same width. The empty Awaiting merge lane is as wide as a lane that holds a card.

Item 2, Done titles. Replay `proof/lane-walk-done.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/lane-walk-done.json --proof .devkit/proof --item 2
```

The Done card shows its title across the lane. No line of the title is one word.

Item 3, the board scrolls inside its frame. Replay `proof/lane-walk-390.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/lane-walk-390.json --proof .devkit/proof --item 3
```

The board scrolls sideways inside its frame. The page does not scroll sideways: `document.documentElement.scrollWidth` equals `document.documentElement.clientWidth`.

Item 4 is `bun run lint`. It checks that the lane width is the `measure.lane` token and that no new colour, `px` or `rem` literal sits outside the tokens.
