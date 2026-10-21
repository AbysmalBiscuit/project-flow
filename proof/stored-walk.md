Replay these walks against recorded tracker responses. Each server sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

DECIDED: an empty store still shows the Settings form. Settings reads the configuration file, which is present before the first poll ends. The empty walk records that form. The other pages keep Loading until the first poll ends.

DECIDED: Inbox and Needs you assert the first paint, then Loading in the live page after the API answers. The walk runner waits for text, so that second assert lands once the page shows Loading. The shot follows that assert.

The filled server delays each `/api` response. `#project-flow-first-paint` records the path and the first text in `#root` on one line. A walk asserts that line without its leading slash. A later API response cannot hide a Loading first paint.

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
