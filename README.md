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
bun src/main.ts
```

The process prints a URL on localhost. Open that URL in a browser.

`--config` sets the configuration file. `--host` sets the host. `--port` sets the port. The default host is `127.0.0.1`.

## Configuration

The configuration file is JSON. The default path is `$XDG_CONFIG_HOME/project-flow/config.json`. When `XDG_CONFIG_HOME` is unset, the path is `~/.config/project-flow/config.json`.

`src/main.ts` builds that path:

```ts
function defaultConfigPath(env: Record<string, string | undefined>): string {
	const root = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(root, "project-flow", "config.json");
}
```

The file can be empty `{}`. Create the file before the first start. These fields are optional:

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

The app reads `GITHUB_TOKEN` from the environment. A blank value does not count. `gh auth token` runs only when a pin uses the GitHub tracker. Without a GitHub pin, the app uses `GITHUB_TOKEN` when it is set and otherwise finds no GitHub projects.

A configuration with only Linear pins starts without a GitHub token. An empty or absent `pinned` list also starts without a GitHub token. The app needs the token when a pin uses the GitHub tracker.

`src/main.ts` decides that:

```ts
		const needsGithub = configuration.pinned.some(
			(pin) => pin.tracker === "github",
		);
```

`src/main.ts` resolves the token:

```ts
async function resolveToken(io: RunIo): Promise<string | null> {
	const fromEnv = io.env.GITHUB_TOKEN;
	if (fromEnv !== undefined && fromEnv.trim() !== "") {
		return fromEnv;
	}
	return io.readGhToken(io.env);
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

The app reads `LINEAR_API_KEY` from the environment. It needs that key when a pinned project uses the Linear tracker. With the key set, the app also finds Linear projects. A GitHub-only configuration starts with no Linear key.

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
