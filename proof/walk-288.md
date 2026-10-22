# Refresh and last poll age

The walks serve recorded tracker responses through `proof/serve-288.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The recorded store holds one poll of `acme/flow`. The server clock stays behind the host clock by the age the mode names. `refresh` holds the next tracker poll. `GET /proof/release` lets that poll finish and polls again.

Item 1. Replay `proof/walk-288-refresh.json`:

```bash
workcell walk-replay --walk-file proof/walk-288-refresh.json --proof .devkit/proof --item 1
```

The walk opens the project page, then `GET /proof/release` polls. The return names an age in seconds and shows `#project-refresh`. `#proof-arm-hold` holds every later project read. The refresh click sends `POST /api/refresh`. The project read stays open, so the refresh icon spins and the page names `Refreshing`. The request log at `/proof/requests` names `POST /api/refresh`. The shot is the page while that fetch is open.

Item 2. Replay `proof/walk-288-age.json`. The walk opens the project page. The recorded clock starts 10 seconds behind the host clock. `GET /proof/age?age=minutes` moves that clock to 5 minutes and polls. `GET /proof/age?age=hours` moves it to 2 hours and polls. Each return to the project page loads the new response. The age reads `fetchedAt` from the query data TanStack Query holds.

```bash
workcell walk-replay --walk-file proof/walk-288-age.json --proof .devkit/proof --item 2
```

The shots name an age in seconds, then `polled 5 min ago`, then `polled 2 h ago`. The seconds count moves while the page stays open. The minutes and hours counts stay on those units.

DECIDED: the age reads `fetchedAt` from the query data when the response carries it, and `dataUpdatedAt` when it does not. The project response already carries that poll time, so the report exposes it. A seeded overview stamps `dataUpdatedAt` from the same field.

DECIDED: the shared pieces are `PollAgeText` and `RefreshButton` in `src/poll-freshness.tsx`. The age text sits in the subtitle. The button sits in the page actions. The project page keeps its own header, so the button sits in that header's toolbar.

DECIDED: one click posts `POST /api/refresh` and invalidates the page query. The icon spins while that query fetches or the overview reports a running poll.
