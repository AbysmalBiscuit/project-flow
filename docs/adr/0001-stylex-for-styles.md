# StyleX for styles

Project Flow styles React components in one Bun process. CSS modules and custom properties in `src/tokens.css` do not check names or types. StyleX replaces CSS modules. The Bun StyleX plugin runs in the dev server and the production build. StyleX variables are the one source of colours and sizes.

## Considered options

- CSS modules and custom properties. The current stack. A misspelled token name fails only in the browser.
- Tailwind. Utility classes move colours and sizes into class strings. The token lint cannot type those strings.
- Vanilla Extract. Typed styles, but a second build step beside Bun.
- Astro or Vite with their style tools. A second bundler. The app stays on Bun.

## Consequences

A component styles only through StyleX. A token lint rejects an unknown property, a token redefinition, and an inline visual literal. Computed graph coordinates stay allowed. CI checks the generated TypeScript token types.
