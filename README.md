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

When the configuration file is missing, the app creates it with its parent folder. The process prints the path. When the configuration file has no state colours, the app writes the default state colours into it.

`--config` sets the configuration file. `--host` sets the host. `--port` sets the port. `--open` opens the printed URL in the default browser. The default host is `127.0.0.1`. Pass flags after `--`, for example `bun start -- --port 4000`.

## Configuration

The configuration file is JSON. The default path is `$XDG_CONFIG_HOME/project-flow/config.json`. When `XDG_CONFIG_HOME` is unset, the path is `~/.config/project-flow/config.json`.

`src/main.ts` builds that path:

```ts
function defaultConfigPath(env: Record<string, string | undefined>): string {
	const root = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(root, "project-flow", "config.json");
}
```

The file can be empty `{}`. `src/configuration.ts` holds the schema. That schema is the full list of fields. The schema holds the current defaults. Each field is optional. An omitted field takes the default below.

- `theme` is `light` or `dark`. The header theme button writes it. The page opens in that theme. The default is `light`.
- `tracked` names the tracked projects. The app polls only these projects, and only these projects show on the overview. The default is `[]`.
- `pollIntervalSeconds` is the gap between polls. The default is `300`.
- `checkoutRoots` names folders the app scans for local checkouts. Each entry is an absolute path. The app does not expand `~`. The default is the `Git` folder in the home directory.
- `expectedBots` names the review bots for a repo. The key is `owner/name`. The value is a list of `grok`, `codex` and `greptile`. An empty list means the repo has no expected bots. When the field is absent, the app reads the bots from the repo's recent merged PRs.
- `pmBot` marks whether a project has a PM Bot. The key is `owner/name` for a repo pin. The key is `owner/number` for a GitHub project pin. The key is the Linear project slug for a Linear pin. `true` sends an unnamed ask to the PM Bot. `false` sends every ask to Lev. When the key is absent, a GitHub project has a PM Bot and a Linear project has none. The default is `{}`.
- `autoMerge` overrides auto-merge for a repo or a project. The key is `owner/name`, `owner/number`, or the Linear project slug. The value is `yes`, `ask` or `no`. The app checks every configuration key first, then workcell `[workflow.standard] merge_auto` by repo, then workcell `[merge] auto` by repo, then the PR auto-merge state and the repo auto-merge setting. The default is `{}`.
- `laneMappings` maps evidence to a named tracker status. The key is the Linear team key or `owner/number` for a GitHub project. Each value maps `backlog`, `inProgress`, `inReview`, `awaitingMerge`, `done` or `dropped` to a status name. A named status keeps its tracker type. The app adds no Awaiting merge lane when `awaitingMerge` names a status. The default is `{}`.
- `states` lists the user's states in board lane order. Each state has an `id`, a `label`, a `colour` in `#rrggbb` form, and a list of `categories`. A category is `backlog`, `inProgress`, `inReview`, `awaitingMerge`, `done` or `dropped`. Each category must be in at least one state. Ids and labels must be unique. The default is one state per category. A file with the old `stateColours` key gets the default states in those colours, and the app writes `states` on the first start.
- `stateMappings` maps tracker statuses and labels to states. The key is the Linear team key, `owner/number` for a GitHub project, or `owner/name` for a repo. Each value maps a status name or a label to a state `id`. A ticket goes to the state of its status, then of its first mapped label. A ticket that evidence moves past its tracker category goes to the first state of its new category, unless the mapped state holds that category. A ticket with no mapping goes to the first state of its category. The default is `{}`.
- `needsYouLabels` names labels that mark a needs-you item when Lev is the assignee. The default is `["needs-human", "needs-engineer"]`.
- `viewerLogins` adds logins that count as Lev. A blank entry does not count. The tracker logins always count. The default is `[]`.
- `notificationTriggers` turns each notification on or off. `needsYou` fires for a new needs-you item. `comment` fires for a new comment. `blockerCleared` fires when a cross-project blocker clears. The default for each one is `true`.

A GitHub pin names a `repo`, or an `owner` and a `project` number. A Linear pin names a `project` slug. Each pin sets `tracker` to `github` or `linear`. `tracked` holds pins of this shape.

```json
{
	"theme": "light",
	"tracked": [{ "tracker": "github", "repo": "owner/name" }],
	"pollIntervalSeconds": 300,
	"checkoutRoots": ["/home/you/Git"],
	"expectedBots": {
		"owner/name": ["grok", "codex"]
	},
	"pmBot": { "owner/name": true },
	"laneMappings": {
		"WID": { "awaitingMerge": "Approved" }
	},
	"states": [
		{
			"id": "backlog",
			"label": "Backlog",
			"colour": "#8a8680",
			"categories": ["backlog"]
		},
		{ "id": "qa", "label": "QA", "colour": "#aa00cc", "categories": [] },
		{
			"id": "inProgress",
			"label": "In progress",
			"colour": "#3b6fd8",
			"categories": ["inProgress"]
		},
		{
			"id": "inReview",
			"label": "In review",
			"colour": "#e07a2f",
			"categories": ["inReview", "awaitingMerge"]
		},
		{
			"id": "done",
			"label": "Done",
			"colour": "#7c5cbf",
			"categories": ["done"]
		},
		{
			"id": "dropped",
			"label": "Dropped",
			"colour": "#9ca3af",
			"categories": ["dropped"]
		}
	],
	"stateMappings": {
		"WID": { "QA": "qa" }
	},
	"needsYouLabels": ["needs-human", "needs-engineer"],
	"viewerLogins": [],
	"notificationTriggers": {
		"needsYou": true,
		"comment": true,
		"blockerCleared": true
	}
}
```

An older file can hold `pinned`, `hidden` and `activityWindowDays`. The app loads that file. Its `pinned` list becomes the `tracked` list when the file has no `tracked` list. The app ignores `hidden` and `activityWindowDays`. The next settings save writes the file without them.

## Tokens

The app reads `GITHUB_TOKEN` from the environment. A blank value does not count. Otherwise the app reads `gh auth token`, whatever the configuration pins. A configuration with only Linear pins reads `gh` the same way, and uses that token to load linked PRs. When neither source gives a token, that configuration still starts. A linked open PR then stays off the ticket, so the ticket stays in backlog. A rejected token stops the start.

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

The store is a cache. Stop the app, then delete `project-flow.sqlite` with `project-flow.sqlite-wal` and `project-flow.sqlite-shm`. The app fills the store again at the next start.

`src/main.ts` builds that path:

```ts
const root = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
return join(root, "project-flow", "project-flow.sqlite");
```

## Develop

`AGENTS.md` holds the development checks.
