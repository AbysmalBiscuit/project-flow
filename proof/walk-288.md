# Refresh and last poll age

The walks serve recorded tracker responses through `proof/serve-288.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The recorded store holds one poll of `acme/flow`. The server clock stays behind the host clock by the age the mode names. `refresh` holds the next tracker poll. `GET /proof/release` lets that poll finish and polls again.

Item 1. Replay `proof/walk-288-refresh.json`:

```bash
workcell walk-replay --walk-file proof/walk-288-refresh.json --proof .devkit/proof --item 1
```

The walk opens the project page, then `GET /proof/release` polls. The return names an age in seconds and shows `#project-refresh`. `#proof-arm-hold` holds every later project read. The refresh click sends `POST /api/refresh`. The project read stays open, so the refresh icon spins and the page names `Refreshing`. The request log at `/proof/requests` names `POST /api/refresh`. The shot is the page while that fetch is open.

Item 2. Replay `proof/walk-288-age.json`. The walk opens the project page once. The recorded store holds a poll 10 seconds old, so the page names `polled 10 s ago`. The walk stays on that page. The proof server injects a script into the served HTML. That script wraps `Date.now` and `new Date()` with no argument. Two visible buttons add 5 minutes and 2 hours to that offset. The app ships neither the script nor the buttons. `#proof-add-minutes` adds 5 minutes. The age timer then names `polled 5 min ago`. `#proof-add-hours` adds 2 hours. The age timer then names `polled 2 h ago`. No step navigates or reloads between those ages. The age reads the TanStack Query fetch time against that browser clock.

```bash
workcell walk-replay --walk-file proof/walk-288-age.json --proof .devkit/proof --item 2
```

The shots name an age in seconds, then `polled 5 min ago`, then `polled 2 h ago`. The seconds count moves while the page stays open. The minutes and hours counts stay on those units.

DECIDED: the age reads `dataUpdatedAt` from the page query. The project response carries no poll time. A seeded overview stamps `dataUpdatedAt` from its `fetchedAt`. The proof server stamps the project query `dataUpdatedAt` from the recorded poll time. The app ships none of that stamp.

DECIDED: the shared pieces are `PollAgeText` and `RefreshButton` in `src/poll-freshness.tsx`. The age text sits in the subtitle. The button sits in the page actions. The project page keeps its own header, so the button sits in that header's toolbar.

DECIDED: one click posts `POST /api/refresh` and invalidates the page query. The icon spins while that query fetches or the overview reports a running poll.
