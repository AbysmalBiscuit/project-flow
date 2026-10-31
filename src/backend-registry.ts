import type { Configuration } from "./configuration.ts";
import {
	type BackendSwitch,
	type BackendViews,
	type ForgeKind,
	forgeKinds,
	type TrackerKind,
	trackerKinds,
} from "./domain.ts";
import {
	type FactoryTokenMint,
	type FactoryTokenReport,
	installationTokenFetch,
} from "./factory-tokens.ts";
import type { Fetch } from "./fetch.ts";
import { checkForgejoToken } from "./forgejo-api.ts";
import { forgejoForge } from "./forgejo-forge.ts";
import { githubPullOfUrl } from "./github-forge.ts";
import { githubHost } from "./github-pin.ts";
import {
	checkToken,
	conditionalFetch,
	githubAdapters,
	missingToken,
	rejectedToken,
	type ValidatorStore,
} from "./github.ts";
import {
	checkGitlabToken,
	gitlabForge,
	gitlabHost,
	gitlabPullOfUrl,
	missingGitlabToken,
	rejectedGitlabToken,
} from "./gitlab-forge.ts";
import {
	checkLinearKey,
	linearTracker,
	missingLinearKey,
	rejectedLinearKey,
} from "./linear.ts";
import {
	type Forge,
	type PullTarget,
	type Tracker,
	TrackerError,
} from "./ports.ts";

export type BackendKind = TrackerKind | ForgeKind;

export const backendKinds: readonly BackendKind[] = [
	...new Set([...trackerKinds, ...forgeKinds]),
];

export type Env = Record<string, string | undefined>;

/** The token of each backend kind with a home, or null when none is set. */
export type Credentials = Partial<Record<BackendKind, string | null>>;

export type TokenIo = {
	env: Env;
	readGhToken: (env?: Env) => Promise<string | null>;
};

export type TokenCheck = "accepted" | "rejected" | { warning: string };

type CredentialRule = {
	env: string;
	/** The token source to read when the env var is empty. */
	fallback?: (io: TokenIo) => Promise<string | null>;
	missing: string;
	rejected: string;
	/** True when this configuration needs the token checked at the start. */
	checked: (configuration: Configuration) => boolean;
	/** Throws on a failure that does not judge the token. */
	check: (token: string, fetchImpl: Fetch) => Promise<TokenCheck>;
};

export type AdapterContext = {
	host: string;
	token: string;
	/** The env var that holds the token, which an error about the token names. */
	tokenEnv: string;
	fetch: Fetch;
	/** The fetch of the repo reads, which the factory tokens and the validators cover. */
	repoFetch: Fetch;
};

/** A factory answers null for a host that its adapter cannot read. */
type Factory<Adapter> = (context: AdapterContext) => Adapter | null;

/** What a backend reads to prepare the fetch of the repo reads. */
export type RepoFetchContext = {
	validators: ValidatorStore;
	configuration: () => Configuration;
	now: () => Date;
	mint: FactoryTokenMint | undefined;
	mintRetryDelayMs: number | undefined;
};

/** The fetch of the repo reads, and the hooks of the tokens that it sends. */
export type RepoFetch = {
	fetch: Fetch;
	reports: () => FactoryTokenReport[];
	mintNow: () => Promise<void>;
	stop: () => void;
};

/** The public host of a backend that needs no declaration, and the rule of its token. */
type Home = {
	/** The host of a project whose pin names no host. */
	host: string;
	credential: CredentialRule;
	/** The PR that a URL on the home host names, read without a token. */
	pullOfUrl?: (url: URL) => PullTarget | null;
	/** True when the repo keys of the home host carry no host, as configuration files before declared hosts wrote them. */
	bareKeys?: true;
};

type Backend<Kind extends BackendKind> = {
	/** The name that the page shows. */
	label: string;
	/** Where the token comes from, as Settings shows it. */
	hint: string;
	/** The settings of this backend that Settings shows as switches. */
	switches?: BackendSwitch[];
	/** A backend without a home reads only the hosts that the configuration declares. */
	home?: Home;
	/** Checks the token of a declared host of this backend. */
	checkHost?: (
		host: string,
		token: string,
		fetch: Fetch,
	) => Promise<TokenCheck>;
	/** Wraps the fetch of the repo reads, such as in a cache of its responses. */
	prepareFetch?: (fetch: Fetch, context: RepoFetchContext) => RepoFetch;
} & (Kind extends TrackerKind
	? { tracker: Factory<Tracker>; home: Home }
	: unknown) &
	(Kind extends ForgeKind ? { forge: Factory<Forge> } : unknown);

/** The help texts of Settings that name each backend. */
export const backendHints: BackendViews["hints"] = {
	runStart:
		"Start run on a GitHub ticket adds the start and queue label. Start run on a Linear ticket writes the workflow state and labels that its hub source names. A GitHub ticket with the label and the queue status of a factory shows as queued. A Linear ticket in the state and labels of its hub source's ready mapping shows as queued.",
	laneMappings:
		"Map a state to a tracker status name for one Linear team or GitHub project.",
};

/**
 * The one record that names each backend. A registry holds the adapters of one
 * app start, so that the tracker and the forge of a kind share one client.
 */
export function backendRegistry(): { [Kind in BackendKind]: Backend<Kind> } {
	let github: ReturnType<typeof githubAdapters> | undefined;
	const githubOf = ({ host, token, repoFetch }: AdapterContext) => {
		if (host !== githubHost) {
			return null;
		}
		github ??= githubAdapters(token, repoFetch);
		return github;
	};
	return {
		github: {
			label: "GitHub",
			hint: "Token from gh auth token",
			switches: [
				{
					setting: "factoryGithubTokens",
					label: "Factory GitHub tokens",
					hint: "GitHub reads and polls use the factory token for that repo owner. Replies stay on your token.",
				},
			],
			home: {
				host: githubHost,
				credential: {
					env: "GITHUB_TOKEN",
					fallback: (io) => io.readGhToken(io.env),
					missing: missingToken,
					rejected: rejectedToken,
					checked: () => true,
					async check(token, fetchImpl) {
						const user = await checkToken(token, fetchImpl);
						if (user.status === 401) {
							return "rejected";
						}
						return user.ok
							? "accepted"
							: { warning: `GitHub token check failed (HTTP ${user.status}).` };
					},
				},
				pullOfUrl: githubPullOfUrl,
				bareKeys: true,
			},
			prepareFetch: (fetchImpl, context) =>
				installationTokenFetch(
					conditionalFetch(fetchImpl, context.validators),
					() => {
						const configuration = context.configuration();
						return {
							enabled: configuration.factoryGithubTokens,
							dir: configuration.factoryGithubTokenDir,
							mintCommand: configuration.factoryMintCommand,
						};
					},
					context.now,
					context.mint,
					context.mintRetryDelayMs,
				),
			tracker: (context) => githubOf(context)?.tracker ?? null,
			forge: (context) => githubOf(context)?.forge ?? null,
		},
		gitlab: {
			label: "GitLab",
			hint: "GITLAB_TOKEN found in the environment",
			home: {
				host: gitlabHost,
				credential: {
					env: "GITLAB_TOKEN",
					missing: missingGitlabToken,
					rejected: rejectedGitlabToken,
					checked: () => true,
					async check(token, fetchImpl) {
						const status = await checkGitlabToken(gitlabHost, token, fetchImpl);
						if (status === 401) {
							return "rejected";
						}
						return status >= 200 && status < 300
							? "accepted"
							: { warning: `GitLab token check failed (HTTP ${status}).` };
					},
				},
				pullOfUrl: gitlabPullOfUrl,
			},
			forge: ({ host, token, fetch }) =>
				host === gitlabHost ? gitlabForge(host, token, fetch) : null,
		},
		linear: {
			label: "Linear",
			hint: "LINEAR_API_KEY found in the environment",
			home: {
				host: "linear.app",
				credential: {
					env: "LINEAR_API_KEY",
					missing: missingLinearKey,
					rejected: rejectedLinearKey,
					checked: ({ tracked }) =>
						tracked.some((pin) => pin.tracker === "linear"),
					async check(key, fetchImpl) {
						try {
							await checkLinearKey(key, fetchImpl);
							return "accepted";
						} catch (error) {
							if (error instanceof TrackerError && error.status === 401) {
								return "rejected";
							}
							throw error;
						}
					},
				},
			},
			tracker: ({ token, fetch }) => linearTracker(token, fetch),
		},
		forgejo: {
			label: "Forgejo",
			hint: "Token from the env var that each declared host names",
			async checkHost(host, token, fetchImpl) {
				const user = await checkForgejoToken(host, token, fetchImpl);
				if (user.status === 401) {
					return "rejected";
				}
				return user.ok
					? "accepted"
					: {
							warning: `Forgejo token check of ${host} failed (HTTP ${user.status}).`,
						};
			},
			forge: ({ host, token, tokenEnv, repoFetch }) =>
				forgejoForge({ host, token, tokenEnv }, repoFetch),
		},
	};
}

export function byKind<Kind extends string, Value>(
	kinds: readonly Kind[],
	value: (kind: Kind) => Value,
): Record<Kind, Value> {
	return Object.fromEntries(kinds.map((kind) => [kind, value(kind)])) as Record<
		Kind,
		Value
	>;
}

export function usable(token: string | null | undefined): string | null {
	const trimmed = token?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}
