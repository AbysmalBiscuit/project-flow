# Read factories by URL

Project Flow reads workcell runs from a list of factories. Each factory is one daemon URL: a hub or a standalone daemon. Project Flow does not find boxes. A hub serves the runs and the run detail of its boxes. A personal setup lists its own daemons, and a company setup lists its hub.

## Considered options

- One hub URL. A personal setup with daemons on a laptop and a desktop has no hub.
- A hub route that lists box URLs, and a connection to each box. Each box needs a reachable address and its own tunnel. Each viewer opens one stream for each run.
- A Postgres mirror of run state. It suits history, not live updates. The laptop then needs database access across the tailnet.

## Consequences

The configuration holds a list of factories. `--factory` can repeat. A run has the same id on a hub and on its box, so Project Flow merges runs by id. The box row is the source of truth for status and stage. Settings warns when a box is also read through a hub. Each daemon URL is `http` or `unix`, and a remote daemon is reached through an ssh socket forward.
