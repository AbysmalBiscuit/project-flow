Replay these walks against recorded tracker responses. Each server sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

Item 2, a filled store. Replay `proof/stored-filled-walk.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/stored-filled-walk.json --proof .devkit/proof --item 2
```

Item 3, an empty store. Replay `proof/stored-empty-walk.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/stored-empty-walk.json --proof .devkit/proof --item 3
```

Item 4, a refresh in progress. Replay `proof/stored-refresh-walk.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/stored-refresh-walk.json --proof .devkit/proof --item 4
```
