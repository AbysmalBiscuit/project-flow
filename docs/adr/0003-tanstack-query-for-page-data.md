# TanStack Query for page data

Each page keeps its own fetch, cache write, Loading flag and refresh flag. The pages repeat the same stale-while-revalidate logic. TanStack Query owns page data on the client. Bun stays the bundler and the server. The app adds no framework.

## Considered options

- Hand-written page caches. The current client. Each new page copies the same fetch and refresh flags.
- A browser storage cache. The store already holds the data. The page response embeds that stored data.
- TanStack Router or TanStack Start. A framework. Bun stays the bundler and the server.
- Astro or Vite. A second bundler. The app stays on Bun.

## Consequences

One QueryClient serves the page. The client survives navigation between pages. A page reads its data through a query. The stored data that the page response embeds seeds the query. A server-sent event updates or invalidates the matching queries. The poll status reads the query fetch state. The project page, Settings and the side panel keep their page cache until they move.
