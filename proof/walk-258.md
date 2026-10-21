# Overview graph card walks

Each walk serves recorded tracker responses through `proof/serve-graph-edges.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker. The overview opens in the graph view.

Item 1. A click on the `acme/alpha` card opens that project page. Replay `proof/walk-258-click.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-258-click.json --proof .devkit/proof --item 1
```

The project page shows `Ship the list`.

Item 2. Enter on the focused `acme/beta` card opens that project page. The card is a link. Replay `proof/walk-258-enter.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-258-enter.json --proof .devkit/proof --item 2
```

Focus the card, then press Enter. The project page shows `Wait on the list`. This runner has no key step, so the replay clicks the same link. The Enter check is in `.devkit/proof/258-browser-walk.log`.

Item 3. A pan drag on the graph stays on the overview. Replay `proof/walk-258-pan.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-258-pan.json --proof .devkit/proof --item 3
```

Drag the pane, including a drag that starts on a card. The overview stays. No project page opens. A click on empty pane is the step this runner can replay. The drag check is in `.devkit/proof/258-browser-walk.log`.
