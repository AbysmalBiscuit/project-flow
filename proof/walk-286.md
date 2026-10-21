# Board lane scroll

Each walk serves recorded tracker responses through `proof/serve-lane-scroll.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The board is `acme/widget`. The ready lane holds 24 cards. The last card title is `Last backlog card sits below the fold`. The factory running lane, the factory in-review lane, Awaiting merge and Done sit beside it.

The proof server inserts `#lane-scroll-probe` and three buttons into each HTML response. Those controls are not in the shipped page. A click on `Scroll lane` sets the ready lane body `scrollTop` to its `scrollHeight` and writes the result. A click on `Scroll board` sets the lanes frame `scrollLeft` to 200.

`walk_replay` pins 1280x800. A walk file name is a label. It is not a viewport the walk runs at.

Item 1, the last card. Replay `proof/walk-286-lane.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-286-lane.json --proof .devkit/proof --item 1
```

Before the click the probe reads `last card outside`. After `Scroll lane` it reads `reached`, `last card inside` and `title held`. The shot shows the last card under the ready title.

Item 2, the lane title. The same walk asserts `title held` after the scroll. The shot is the item 1 shot.

Item 3, sideways board scroll. Replay `proof/walk-286-sideways.json`. That file name is a label. `walk_replay` does not run it at 700:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-286-sideways.json --proof .devkit/proof --item 3
```

The page loads `/proof/lane-700`. That page frames the board at 700 wide. The probe reads `board wider`, `board moved` and `page scrollWidth 700 clientWidth 700 equal`.

Item 4, phone width. Replay `proof/walk-286-390.json`. That file name is a label. `walk_replay` does not run it at 390:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-286-390.json --proof .devkit/proof --item 4
```

The page loads `/proof/lane-390`. That page frames the board at 390 wide. The probe reads `page scrollWidth 390 clientWidth 390 equal` and `board moved`.

Item 5, StyleX variables. The lane scroll styles in `src/ui-styles.ts` use tokens from `src/tokens.stylex.ts`. `bun run lint` rejects a colour, `px` or `rem` literal in that style.
