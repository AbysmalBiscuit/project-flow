# Tracker and forge ports

Project Flow reaches tickets through a `Tracker` port and PRs through a `Forge` port. A tracker owns tickets, statuses, labels, parent tickets and blocker links. A forge owns branches, PRs, reviews, checks and merge state. A ticket's tracker and its repo's forge can be different systems, so a Linear ticket can link to a GitLab PR. GitHub implements both ports.

## Considered options

- One tracker port that also lists PRs. Each tracker without a forge, such as Linear, then fetches PRs from one forge itself and cannot reach another forge.
- Call each forge's API directly from the core, as workcell does for GitHub. The core then holds a code path for each forge.

## Consequences

- A tracker returns PR references, such as the URL of a Linear attachment. The forge that owns the URL fetches the PR. The link rules stay in the core.
- The repo URL selects the forge by its host. The configuration declares each self-hosted host with its forge kind and the env var of its token.
- A port is an object type of function properties. An adapter is a factory function that closes over its token and `fetch`. An optional capability is an optional property, so the compiler checks for it before a call.
- A `const` tuple holds the kinds of each port. One `Record` from kind to factory is the only code that names the backends.
- Each tracker adapter exports its configuration pin schema. The configuration schema joins the pin schemas into one discriminated union.
- The API sends the ticket URL and the list of configured trackers and forges. The client names no backend.
- A ticket ref holds its tracker as data. No code infers the tracker from the shape of a key.
- Tests stay at the HTTP API. They serve recorded responses of each forge and tracker through the fake `fetch`.
