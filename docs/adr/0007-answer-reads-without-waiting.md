# Answer reads without waiting

No API read and no page waits for a poll, a discovery, a tracker read or a factory call. Each read answers at once from the store, the configuration or the last stored answer. A poll, a discovery or a factory check refreshes the data in the background. When the data changes, the app sends an overview event, and the page reads again.

A read that the app has stored no answer for answers `202` with `{ "pending": true }`. The app reads it in the background and keeps the answer. The next read gets that answer and starts a new background read. The page keeps what it holds, or shows its Loading state, until the event comes. A factory that the app has not checked yet has `reachable: null`, and Settings shows it as not checked.

## Considered options

- A read that waits for the running poll, with a time limit. A slow tracker or a dead ssh forward then holds the page for the full limit.
- A read that waits only for discovery. A factory check or a thread read still holds the page.

## Consequences

A settings write waits for discovery in the write path. The bot key check and a tracked-list write then see the catalogue of the running poll. The first read of a thread, a checkpoint or the agents of a run has no data. A test of such a read reads again until the answer is not `202`.

The settings read carries `discovering: true` while a discovery runs, because its catalogue can still change. A start on a stored board shows no running poll, so the overview alone does not tell a reader that discovery has ended. A test that reads the catalogue reads again until `discovering` is gone.
