# Query walks

Each walk serves recorded tracker responses. The walk starts its own server. That server sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

Each walk uses `proof/serve-265.ts`. That server tracks `acme/widget` and answers tracker calls from recorded responses. In `filled` mode the server waits until the store holds a settled poll, then holds every later `GET /api/projects/*`, `GET /api/settings`, `GET /api/overview` and `GET /api/threads/*`. A page that shows its data after that hold reads the stored payload, not a fresh fetch. `live` mode leaves those reads open so a reply can load the thread.

Item 2, a settings save and a reply. Replay `proof/walk-265-save.json` and `proof/walk-265-reply.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-265-save.json --proof .devkit/proof --item 2
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-265-reply.json --proof .devkit/proof --item 2
```

The save walk opens Settings, clicks General, and changes Open projects in from Last used view to Board. It clicks General again after Save. The page shows `Settings saved` and `Board` on the same page. The reply walk opens the project page, opens ticket `acme/widget#7`, and sends `Use the lane name`. The thread shows that text after the reply, with no reload.

Item 4, a filled reload never shows Loading. Replay `proof/walk-265-reload.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-265-reload.json --proof .devkit/proof --item 4
```

The server fills the store before it listens. It then holds the page reads. The walk opens the project page and Settings. The project page shows `Ship the board`. Settings shows `60 minutes`. Those lines come from the stored payload. The walk has no absent-text step. `Loading` is the only other full-page state for those routes, so a page that shows the stored lines does not show `Loading`.
