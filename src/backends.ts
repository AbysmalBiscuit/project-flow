import type { Configuration } from "./configuration.ts";
import {
	type BackendSwitch,
	type BackendView,
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
import { checkForgejoToken, forgejoForge } from "./forgejo-forge.ts";
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
	checkLinearKey,
	linearTracker,
	missingLinearKey,
	rejectedLinearKey,
} from "./linear.ts";
import { type Forge, type Tracker, TrackerError } from "./ports.ts";
import { type ProjectRef, refHost } from "./project-ref.ts";
import { takesClaimedStart } from "./run-start.ts";

export type { FactoryTokenMint };

type BackendKind = TrackerKind | ForgeKind;

const backendKinds: readonly BackendKind[] = [
	...new Set([...trackerKinds, ...forgeKinds]),
];

export type Env = Record<string, string | undefined>;

/** The token of each backend kind with a home, or null when none is set. */
export type Credentials = Partial<Record<BackendKind, string | null>>;

export type TokenIo = {
	env: Env;
	readGhToken: (env?: Env) => Promise<string | null>;
};

type TokenCheck = "accepted" | "rejected" | { warning: string };

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

type AdapterContext = {
	host: string;
	token: string;
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
const backendHints: BackendViews["hints"] = {
	runStart:
		"Start run on a GitHub ticket adds the start and queue label. Start run on a Linear ticket writes the workflow state and labels that its hub source names. A GitHub ticket with the label and the queue status of a factory shows as queued. A Linear ticket in the state and labels of its hub source's ready mapping shows as queued.",
	laneMappings:
		"Map a state to a tracker status name for one Linear team or GitHub project.",
};

/**
 * The one record that names each backend. A registry holds the adapters of one
 * app start, so that the tracker and the forge of a kind share one client.
 */
function backendRegistry(): { [Kind in BackendKind]: Backend<Kind> } {
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
			forge: ({ host, token, repoFetch }) =>
				forgejoForge(host, token, repoFetch),
		},
	};
}

function byKind<Kind extends string, Value>(
	kinds: readonly Kind[],
	value: (kind: Kind) => Value,
): Record<Kind, Value> {
	return Object.fromEntries(kinds.map((kind) => [kind, value(kind)])) as Record<
		Kind,
		Value
	>;
}

function usable(token: string | null | undefined): string | null {
	const trimmed = token?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

/** Reads the token of each backend kind from its env var, or else from its fallback. A backend without a home has none. */
export async function readCredentials(io: TokenIo): Promise<Credentials> {
	const registry = backendRegistry();
	const tokens = new Map(
		await Promise.all(
			backendKinds.map(async (kind) => {
				const rule = registry[kind].home?.credential;
				const token =
					rule === undefined
						? null
						: (usable(io.env[rule.env]) ?? usable(await rule.fallback?.(io)));
				return [kind, token] as const;
			}),
		),
	);
	return byKind(backendKinds, (kind) => tokens.get(kind) ?? null);
}

type TokenTest = {
	check: () => Promise<TokenCheck>;
	rejected: string;
};

/** Checks each token that the configuration needs, then the token of each declared host. Answers the message that stops the start, or null. */
export async function rejectedCredential(
	credentials: Credentials,
	configuration: Configuration,
	env: Env,
	fetchImpl: Fetch,
	warn: (message: string) => void,
): Promise<string | null> {
	const registry = backendRegistry();
	const tests: TokenTest[] = [];
	for (const kind of backendKinds) {
		const rule = registry[kind].home?.credential;
		const token = credentials[kind] ?? null;
		if (rule !== undefined && token !== null && rule.checked(configuration)) {
			tests.push({
				check: () => rule.check(token, fetchImpl),
				rejected: rule.rejected,
			});
		}
	}
	for (const { host, forge, tokenEnv } of configuration.hosts) {
		const token = usable(env[tokenEnv]);
		const checkHost = registry[forge].checkHost;
		if (token !== null && checkHost !== undefined) {
			tests.push({
				check: () => checkHost(host, token, fetchImpl),
				rejected: `${tokenEnv} was rejected by ${host} (HTTP 401): set a valid token.`,
			});
		}
	}
	for (const { check, rejected } of tests) {
		const verdict = await check();
		if (verdict === "rejected") {
			return rejected;
		}
		if (verdict !== "accepted") {
			warn(verdict.warning);
			return null;
		}
	}
	return null;
}

/** The fetch of the repo reads, wrapped by each backend that prepares it. */
export function prepareRepoFetch(
	fetchImpl: Fetch,
	context: RepoFetchContext,
): RepoFetch {
	const registry = backendRegistry();
	return backendKinds.reduce<RepoFetch>(
		(prepared, kind) => {
			const next = registry[kind].prepareFetch?.(prepared.fetch, context);
			if (next === undefined) {
				return prepared;
			}
			return {
				fetch: next.fetch,
				reports: () => [...prepared.reports(), ...next.reports()],
				mintNow: async () => {
					await Promise.all([prepared.mintNow(), next.mintNow()]);
				},
				stop: () => {
					prepared.stop();
					next.stop();
				},
			};
		},
		{
			fetch: fetchImpl,
			reports: () => [],
			mintNow: () => Promise.resolve(),
			stop: () => {},
		},
	);
}

export type ProjectReader = { tracker: Tracker } | { error: string };

type Hosts = Configuration["hosts"];

export type Backends = {
	trackers: ReadonlyMap<TrackerKind, Tracker>;
	/** The forge of each host that a poll has read. */
	forges: ReadonlyMap<string, Forge>;
	/** Each tracker and forge kind with its label and whether it has a token. A forge without a home shows once a host declares it. */
	views: (hosts: Hosts) => BackendViews;
	/** The tracker that reads the project of `ref`, or the error to show on it. */
	readerOf: (ref: ProjectRef, hosts: Hosts) => ProjectReader;
	/** The forge that serves `host`, or null when no forge with a token serves it. */
	forgeAt: (host: string, hosts: Hosts) => Forge | null;
	/** The name of the forge on the host of `url`, or undefined when no forge serves that host. */
	forgeLabelOf: (url: string, hosts: Hosts) => string | undefined;
	/** The forge that holds the repo of the project of `ref`. */
	forgeOf: (ref: ProjectRef) => Forge | null;
	/** The declared host of a forge, or undefined for a forge on its own home host. */
	declaredHostOf: (forge: Forge) => string | undefined;
	/** True for an error that `readerOf` gave: the project waits for a setting and no read failed. */
	explains: (error: string) => boolean;
};

export function buildBackends(options: {
	credentials: Credentials;
	env: Env;
	fetch: Fetch;
	repoFetch: Fetch;
}): Backends {
	const { credentials, env, fetch, repoFetch } = options;
	const registry = backendRegistry();
	const homeContext = (kind: BackendKind): AdapterContext | null => {
		const token = credentials[kind] ?? null;
		const home = registry[kind].home;
		return token === null || home === undefined
			? null
			: { host: home.host, token, fetch, repoFetch };
	};
	const homeHosts = new Set(
		backendKinds.flatMap((kind) => registry[kind].home?.host ?? []),
	);
	const view = <Kind extends BackendKind>(
		kind: Kind,
		hosts: Hosts,
	): BackendView<Kind> => {
		const declared = hosts.filter((entry) => entry.forge === kind);
		const present =
			(credentials[kind] ?? null) !== null ||
			declared.some((entry) => usable(env[entry.tokenEnv]) !== null);
		return {
			kind,
			label: registry[kind].label,
			hint: registry[kind].hint,
			credential: present ? "present" : "missing",
		};
	};
	const trackers = new Map<TrackerKind, Tracker>();
	for (const kind of trackerKinds) {
		const context = homeContext(kind);
		const tracker = context === null ? null : registry[kind].tracker(context);
		if (tracker !== null) {
			trackers.set(kind, tracker);
		}
	}
	const forges = new Map<string, Forge>();
	for (const kind of forgeKinds) {
		const context = homeContext(kind);
		const forge = context === null ? null : registry[kind].forge(context);
		const home = registry[kind].home;
		if (forge !== null && home !== undefined) {
			forges.set(home.host, forge);
		}
	}
	/** The forge of each declared host, by its host, forge kind and token, so that its reads keep their cache across polls. */
	const declaredForges = new Map<string, Forge | null>();
	const hostedForge = (
		host: string,
		hosts: Hosts,
	): { forge: Forge; context: AdapterContext } | { error: string } => {
		const declared = hosts.find((entry) => entry.host === host);
		if (declared === undefined) {
			return { error: `${host} is not declared in hosts.` };
		}
		const token = usable(env[declared.tokenEnv]);
		if (token === null) {
			return {
				error: `${declared.tokenEnv} is missing: set ${declared.tokenEnv} to read ${host}.`,
			};
		}
		const context = { host, token, fetch, repoFetch };
		const id = JSON.stringify([host, declared.forge, token]);
		if (!declaredForges.has(id)) {
			declaredForges.set(id, registry[declared.forge].forge(context));
		}
		const forge = declaredForges.get(id) ?? null;
		if (forge === null) {
			return { error: `the ${declared.forge} forge cannot read ${host} yet.` };
		}
		forges.set(host, forge);
		return { forge, context };
	};
	const explained = new Set<string>();
	const unreadable = (error: string): ProjectReader => {
		explained.add(error);
		return { error };
	};
	const hostedReader = (
		kind: TrackerKind,
		host: string,
		hosts: Hosts,
	): ProjectReader => {
		const hosted = hostedForge(host, hosts);
		if ("error" in hosted) {
			return unreadable(hosted.error);
		}
		const tracker = registry[kind].tracker(hosted.context);
		return tracker === null
			? unreadable(`the ${kind} tracker cannot read ${host} yet.`)
			: { tracker };
	};
	return {
		trackers,
		forges,
		views: (hosts) => ({
			trackers: trackerKinds.map((kind) => ({
				...view(kind, hosts),
				claimsRuns: takesClaimedStart(kind),
			})),
			forges: forgeKinds
				.filter(
					(kind) =>
						registry[kind].home !== undefined ||
						hosts.some((entry) => entry.forge === kind),
				)
				.map((kind) => view(kind, hosts)),
			switches: backendKinds.flatMap((kind) => registry[kind].switches ?? []),
			hints: backendHints,
		}),
		readerOf(ref, hosts) {
			const host = refHost(ref);
			if (host !== undefined) {
				return hostedReader(ref.tracker, host, hosts);
			}
			const tracker = trackers.get(ref.tracker);
			return tracker === undefined
				? unreadable(registry[ref.tracker].home.credential.missing)
				: { tracker };
		},
		forgeAt(host, hosts) {
			if (homeHosts.has(host)) {
				return forges.get(host) ?? null;
			}
			const hosted = hostedForge(host, hosts);
			return "error" in hosted ? null : hosted.forge;
		},
		forgeLabelOf(url, hosts) {
			const host = URL.parse(url)?.host;
			const kind =
				forgeKinds.find((forge) => registry[forge].home?.host === host) ??
				hosts.find((declared) => declared.host === host)?.forge;
			return kind === undefined ? undefined : registry[kind].label;
		},
		forgeOf: (ref) =>
			forges.get(refHost(ref) ?? registry[ref.tracker].home.host) ?? null,
		declaredHostOf(forge) {
			for (const [host, held] of forges) {
				if (held === forge && !homeHosts.has(host)) {
					return host;
				}
			}
			return undefined;
		},
		explains: (error) => explained.has(error),
	};
}
