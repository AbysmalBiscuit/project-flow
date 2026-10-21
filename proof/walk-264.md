# Page data walks

Each walk serves recorded tracker responses. The walk starts its own server. That server sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

Each walk uses `proof/serve-264.ts`. That server tracks `acme/flow` and answers tracker calls from recorded responses. `GET /proof/requests` shows how many `GET /api/overview` requests the browser sent. `GET /proof/hold` holds every later `GET /api/overview` after the first page load. `GET /proof/hold?lists=1` holds `GET /api/needs-you` and `GET /api/inbox` at once. It does not hold `GET /api/overview`. A later `POST /api/refresh` releases a held poll.

Item 4, one QueryClient across client navigation. Replay `proof/walk-264-nav.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-264-nav.json --proof .devkit/proof --item 4
```

The walk clears the request log, opens Overview, opens Needs you, and returns to Overview. The request page shows `overview fetches 1`. The first EventSource open invalidates the seeded overview, so the load sends one `GET /api/overview`. The return sends no second fetch.

Item 6, stored data seeds the query. Replay `proof/walk-264-seed.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-264-seed.json --proof .devkit/proof --item 6
```

Each page seeds from its own embedded payload before the first render. The walk order is:

1. `GET /proof/hold?lists=1` holds `GET /api/needs-you` and `GET /api/inbox` at once. It does not hold `GET /api/overview`.
2. Open `/needs-you`. The page shows `Nothing needs you` while those fetches stay held.
3. Open `/inbox`. The page shows `No notifications` while those fetches stay held.
4. `GET /proof/hold` holds `GET /api/overview`. The overview hold stays on from step 5 to the end of the walk. The list hold from step 1 stays on.
5. Open `/`. The page shows project counts and `acme/flow` while `GET /api/overview` stays held.

The asserted text cannot come from the held fetches. The overview fetch is not held on the Needs you and Inbox steps, so the refresh icon on those pages can stop. The replay runner has no absent-text action. Those settled lines are the lists the seed writes, so the pages do not show `Loading`.

Item 7, a server-sent event updates the page. Replay `proof/walk-264-sse.json`:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-264-sse.json --proof .devkit/proof --item 7
```

The first paint shows the project name `acme/flow` and `0 of 1 done` from the stored poll. The walk clicks Refresh on the same page. The page shows `1 of 1 done` from the later poll, with no reload. The overview card paints the project name and the done line. It does not paint the ticket title. A closed ticket stays in its tracker lane, so the card does not paint a Dropped count.

Item 8, the refresh icon. Replay `proof/walk-264-refresh.json`. The walk opens Overview. `/proof/hold` holds every later `GET /api/overview` after that first page load. The walk returns to Overview and clicks Refresh:

```
python3 /home/lev/.grok/installed-plugins/workcell-a8292766/skills/manage/scripts/walk_replay.py --walk-file proof/walk-264-refresh.json --proof .devkit/proof --item 8
```

The page shows `Refreshing` and the project name `acme/flow` while the overview response stays held. The icon shows while the overview fetch or the poll runs. The old project data stays on screen. The walk reads the hidden word `Refreshing`.
