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

A GitHub pin names a `repo`, or an `owner` and a `project` number. A Linear pin names a `project` slug. Each pin sets `tracker` to `github` or `linear`.

```json
{
  "pinned": [
    { "tracker": "github", "repo": "owner/name" }
  ],
  "hidden": [],
  "activityWindowDays": 30
}
```

## Tokens

The app reads `GITHUB_TOKEN` from the environment. A blank value does not count. When that variable is missing or blank, the app runs `gh auth token`.

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

## Develop

`AGENTS.md` holds the development checks.
