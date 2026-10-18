# Project Flow

Project Flow is a local web app. It shows how projects and tickets progress across GitHub and Linear.

## Setup

Run `bun install`, then `prek install`. The hooks run the CI checks before a commit and a push. A devkit worktree runs `bun install` when it is created.

The checks are `bun run typecheck`, `bun run test` and `bun run check`. `bun run format` fixes format and import order.

## Coding standards

The parent spec, issue #1, holds the full rules. Use the terms in `GLOSSARY.md`.

### Stack

- One Bun process serves the React page and the JSON API on localhost. Bun bundles the page from an HTML import. Do not add a bundler or a framework.
- Bun's built-in SQLite is the store. The store is a cache: the next poll fills it again.
- One Zod schema validates the configuration file and gives its TypeScript type. Do not write a second type for the configuration.
- The browser renders diagrams with Mermaid.

### Architecture

The code is hexagonal.

- The domain core is pure functions with no I/O. All state, grouping, review cycle, blocker, link and needs-you rules live in the core.
- The core reaches the outside only through ports: tracker, store, notifier, clock and configuration.
- Driven adapters implement the ports: GitHub, Linear, SQLite and the configuration file.
- The HTTP API and the server-sent event stream are the driving adapter.
- Each tracker adapter sends all its network calls through the one `fetch` that the app gets at startup.
- The shipped CLI does not carry test fixtures or test-only flags.

### Tests

- The one test seam is the HTTP API. Tests start the real app with a temporary store, a temporary configuration file and a fake `fetch`.
- The fake `fetch` serves tracker responses recorded from real tickets and PRs. It also records each request that the app sends.
- Tests assert only on API responses, server-sent events and the requests sent to the trackers.
- Do not write unit tests below the seam. Test a domain rule through the HTTP API.
- Tests never call a live tracker API.
- React components are thin views of the API responses and have no test suite. A browser check of the running app is a proof step for each UI change.

### TypeScript

- Do not use `any`. Let inference carry types, and derive types from schemas and functions.
- The compiler runs in strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Do not weaken `tsconfig.json`.
- Run JavaScript and TypeScript with `bun`, never `node` or `npx`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `AbysmalBiscuit/project-flow`, through `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
