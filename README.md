# Project Flow

Project Flow is a local web app. It shows how projects and tickets progress across GitHub and Linear.

The page shows each project's progress by state. The terms are in `GLOSSARY.md`.

## Start

Install the dependencies:

```sh
bun install
```

Start the app:

```sh
bun start
```

`bun run dev` starts the app with hot reload. `devkit run task start` installs the dependencies, then serves the app on its devkit port.

The process prints a URL on localhost. Open that URL in a browser.

When the configuration file is missing, the app creates it as `{}`, with its parent folder. The process prints the path.

`--config` sets the configuration file. `--host` sets the host. `--port` sets the port. The default host is `127.0.0.1`. Pass flags after `--`, for example `bun start -- --port 4000`.

## Configuration

The configuration file is JSON. The default path is `$XDG_CONFIG_HOME/project-flow/config.json`. When `XDG_CONFIG_HOME` is unset, the path is `~/.config/project-flow/config.json`.

`src/main.ts` builds that path:

```ts
function defaultConfigPath(env: Record<string, string | undefined>): string {
	const root = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(root, "project-flow", "config.json");
}
```

The file can be empty `{}`. These fields are optional:

- `pinned` names projects that always show.
- `hidden` names projects that never show.
- `activityWindowDays` is the activity window for a found project.
- `expectedBots` names the review bots for a repo. The key is `owner/name`. The value is a list of `grok`, `codex` and `greptile`. An empty list means the repo has no expected bots. When the field is absent, the app reads the bots from the repo's recent merged PRs.

A GitHub pin names a `repo`, or an `owner` and a `project` number. A Linear pin names a `project` slug. Each pin sets `tracker` to `github` or `linear`.

```json
{
  "pinned": [
    { "tracker": "github", "repo": "owner/name" }
  ],
  "hidden": [],
  "activityWindowDays": 30,
  "expectedBots": {
    "owner/name": ["grok", "codex"]
  }
}
```

## Tokens

The app reads `GITHUB_TOKEN` from the environment. A blank value does not count. Otherwise the app reads `gh auth token`, whatever the configuration pins. A configuration with only Linear pins reads `gh` the same way, and uses that token to load linked PRs. When neither source gives a token, that configuration still starts. A linked open PR then stays off the ticket, so the ticket stays in backlog. A rejected token stops the start only when a pin uses the GitHub tracker.

An empty configuration starts without a token when neither source gives one. A pin that uses the GitHub tracker also starts. Each GitHub project shows an error that names `GITHUB_TOKEN`. A GitHub project found from a local checkout shows that same error.

`src/main.ts` resolves the token:

```ts
async function resolveToken(
	io: RunIo,
	envToken: string | null,
): Promise<string | null> {
	if (envToken !== null) {
		return envToken;
	}
	const fromGh = await io.readGhToken(io.env);
	if (fromGh === null || fromGh.trim() === "") {
		return null;
	}
	return fromGh;
}
```

`readGhAuthToken` runs `gh auth token`:

```ts
		proc = Bun.spawn([gh, "auth", "token"], {
			stdout: "pipe",
			stderr: "pipe",
			env,
		});
```

The app reads `LINEAR_API_KEY` from the environment. A blank value does not count. With the key set, the app finds Linear projects. With no key, each Linear project shows an error that names `LINEAR_API_KEY`. The projects of the other tracker poll. A rejected token or key exits and names that credential.

## Store

The store is a Bun SQLite file. The path is `$XDG_DATA_HOME/project-flow/project-flow.sqlite`. When `XDG_DATA_HOME` is unset, the path is `~/.local/share/project-flow/project-flow.sqlite`.

The store is a cache. Deleting the file is safe. The app fills the store again at the next start.

`src/main.ts` builds that path:

```ts
	const root = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	return join(root, "project-flow", "project-flow.sqlite");
```

## Develop

`AGENTS.md` holds the development checks.
