# Keep a run history in the store

Project Flow keeps a run history in its SQLite store. The run history holds one row for each run that a factory reports in `GET /runs`. Insight queries read the run history through views with stable column names. The aggregates of the Factories, Workflows, Verification and Retros tabs read it too. This decision replaces the part of ADR 0006 that says Project Flow keeps no run history.

## Considered options

- Read `GET /runs` of each factory for each aggregate and each query. A factory serves only the runs that it still lists, and SQL cannot run over an HTTP answer.
- A central Postgres mirror of all factories. It is not set up, and a local app needs no server.
- A history in each factory, served by a new workcell route. Each factory then answers for its own runs only, and a query across factories needs Project Flow to join the answers.

## Consequences

- The run history keeps a run after its factory stops listing it, so cost and result queries cover old runs.
- A delete of a run in Project Flow deletes its row from the run history. An archive keeps the row and sets its `archived_at` value.
- The store stays a cache for the runs that the factories still list: the next factory read fills their rows again after a lost store. The rows of other runs are lost with the store.
- Insight queries run on a second, read-only SQLite connection, so a query cannot change the store.
- Later run history tables, such as host samples, follow the same rule: Project Flow fills them from factory routes and keeps them in the store.
- Stage rows come from the stage events of the factory feed. An ended run with no stage rows gets its stage rows from one read of its event log.
- Turn rows come from one `GET /runs/{id}/turns` read of each ended run, because the turns of an ended run do not change.
- Ask rows come from the asks reads that Project Flow already sends.
- The verification record of a run comes from one `GET /runs/{id}/verification` read of each ended run. A 404 stores no record, and the Verification tab names the factory that does not serve the route.
- The retro of a run comes from one `GET /runs/{id}/retro` read of each ended run. A 404 stores an empty retro, and the Retros tab names the factory that does not serve the route. A read of one run's retro reads the factory again when no retro is stored, and keeps the answer.
- The backfill reads run in the background with a small fixed limit on concurrent reads, so a first start does not flood a factory.
