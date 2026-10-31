# Project Flow

Project Flow is a local web app. It shows how projects and tickets progress across GitHub and Linear.

## Setup

Run `bun install`, then `prek install`. The hooks run the CI checks before a commit and a push. A devkit worktree runs `bun install` when it is created. `bunfig.toml` sets `minimumReleaseAge`, so `bun install` and `bun add` do not resolve a package version younger than three days.

The checks are `bun run typecheck`, `bun run test` and `bun run lint`. `bun run typecheck` runs `bun check`, the Bun type checker. `bun fmt` is the formatter, and Biome is the linter. `bun run format` runs `bun fmt`, which fixes format and import order. `bun run lint` checks format with `bun fmt --check` and runs the Biome linter.

The pre-push hook runs only the tests that the change affects. The copy of `scripts/affected-tests.ts` on `origin/main` selects them and prints the reason for each choice. A change to shared test setup, the lockfile, the package files or the hook scripts runs the full suite. Set `PROJECT_FLOW_FULL_SUITE=1` to force the full suite. `bun run test`, the `check` task and CI always run the full suite. `scripts/test-slot.sh` runs a suite in four workers in random order. Pass `--seed=N` to run an order again.

## Coding standards

Issue #1 holds the v1 rules. Issue #97 overrides #1 where they differ. Use the terms in `GLOSSARY.md`.

### Stack

- The stack is Bun, React and StyleX. One Bun process serves the React page and the JSON API on localhost. Bun bundles the page from an HTML import. Do not add a second bundler or a framework.
- TanStack Query is the client data layer (ADR 0003). One QueryClient serves the page. The project page, Settings and the side panel read the page cache.
- Styles use StyleX (ADR 0001). The StyleX Bun plugin in `bunfig.toml` runs in the dev server and the production build.
- Bun's built-in SQLite is the store. The store is a cache: the next poll fills it again. The notifications table and seeded_ids keep history.
- One Zod schema validates the configuration file and gives its TypeScript type. Do not write a second type for the configuration.
- React Flow draws the graphs (ADR 0002).
- StyleX variables in `src/tokens.stylex.ts` are the one source of colours and sizes.
- A component styles only through StyleX. Do not add a colour, `px` or `rem` literal outside a StyleX variable. Computed graph coordinates stay allowed.

### Architecture

The code is hexagonal.

- The domain core is pure functions with no I/O. All state, grouping, review cycle, blocker, link and needs-you rules live in the core.
- The core reaches the outside only through ports: tracker, forge, store, notifier, clock and configuration.
- Driven adapters implement the ports: GitHub, Linear, SQLite and the configuration file.
- The HTTP API and the server-sent event stream are the driving adapter.
- Each tracker adapter sends all its network calls through the one `fetch` that the app gets at startup.
- The shipped CLI does not carry test fixtures or test-only flags.

### Tests

- The one test seam is the HTTP API. Tests start the real app with a temporary store, a temporary configuration file and a fake `fetch`.
- A test of a repo script runs the script itself on a temporary git repository.
- The fake `fetch` serves tracker responses recorded from real tickets and PRs. It also records each request that the app sends.
- Tests assert only on API responses, server-sent events and the requests sent to the trackers.
- Do not write unit tests below the seam. Test a domain rule through the HTTP API.
- Tests never call a live tracker API.
- The graph layout runs only in the client. Its layout suite is an exception to the seam: it tests the layout functions on recorded tickets.
- React components are thin views of the API responses and have no test suite. A browser check of the running app is a proof step for each UI change.
- Each proof, screenshot or manual run sets `XDG_DATA_HOME` to a temporary folder.

#### Test layout

```
test/
  support/           shared harness, one file per concern
    app.ts           start the app: temporary store, configuration and fake fetch
    fetch.ts         fake fetch basics: request URLs, JSON answers, tracker requests
    github.ts        recorded GitHub answers: discovery, issue lists, pages, pulls
    repo-read.ts     recorded answers to the GitHub repo read query
    checkouts.ts     temporary git checkouts and devkit worktrees
    linear.ts        recorded Linear answers: issues, the Linear fake
    factory.ts       hub and daemon fakes
    reads.ts         API reads that wait for a state: overview, settings, events
    states.ts        the default states of a fresh configuration file
  fixtures/
  <area>/            *.test.ts of one area of the API
  <area>/_support.ts helpers that only the tests of one area share
```

- A helper that tests in two areas use lives in `test/support/`. A helper that one area uses lives in `<area>/_support.ts`. A helper that one file uses stays in that file.
- A test file never defines an exact copy of a helper that `test/support/` exports. It imports the helper.
- No folder holds tests below the HTTP API. The graph layout suite and the repo script tests keep their own folders.

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

### Workcell roles

The workcell standard workflow sets the agent of each role. `.agents/workcell.toml` sets only the merge policy. A senior agent runs in each run and does the senior review.
