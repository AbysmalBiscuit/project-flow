import type { Configuration } from "./configuration.ts";
import {
	type BackendView,
	type BackendViews,
	type ForgeKind,
	forgeKinds,
	type TrackerKind,
	trackerKinds,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubHost } from "./github-pin.ts";
import {
	checkToken,
	githubAdapters,
	missingToken,
	rejectedToken,
} from "./github.ts";
import {
	checkLinearKey,
	linearTracker,
	missingLinearKey,
	rejectedLinearKey,
} from "./linear.ts";
import { type Forge, type Tracker, TrackerError } from "./ports.ts";
import { type ProjectRef, refHost } from "./project-ref.ts";

type BackendKind = TrackerKind | ForgeKind;

const backendKinds: readonly BackendKind[] = [
	...new Set([...trackerKinds, ...forgeKinds]),
];

export type Env = Record<string, string | undefined>;

/** The token of each backend kind, or null when none is set. */
export type Credentials = Record<BackendKind, string | null>;

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

type Backend<Kind extends BackendKind> = {
	/** The name that the page shows. */
	label: string;
	/** Where the token comes from, as Settings shows it. */
	hint: string;
	credential: CredentialRule;
	/** The host of a project whose pin names no host. */
	homeHost: string;
} & (Kind extends TrackerKind ? { tracker: Factory<Tracker> } : unknown) &
	(Kind extends ForgeKind ? { forge: Factory<Forge> } : unknown);

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
			homeHost: githubHost,
			tracker: (context) => githubOf(context)?.tracker ?? null,
			forge: (context) => githubOf(context)?.forge ?? null,
		},
		linear: {
			label: "Linear",
			hint: "LINEAR_API_KEY found in the environment",
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
			homeHost: "linear.app",
			tracker: ({ token, fetch }) => linearTracker(token, fetch),
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

/** Reads the token of each backend kind from its env var, or else from its fallback. */
export async function readCredentials(io: TokenIo): Promise<Credentials> {
	const registry = backendRegistry();
	const tokens = new Map(
		await Promise.all(
			backendKinds.map(async (kind) => {
				const rule = registry[kind].credential;
				const token =
					usable(io.env[rule.env]) ?? usable(await rule.fallback?.(io));
				return [kind, token] as const;
			}),
		),
	);
	return byKind(backendKinds, (kind) => tokens.get(kind) ?? null);
}

/** Checks each token that the configuration needs. Answers the message that stops the start, or null. */
export async function rejectedCredential(
	credentials: Credentials,
	configuration: Configuration,
	fetchImpl: Fetch,
	warn: (message: string) => void,
): Promise<string | null> {
	const registry = backendRegistry();
	for (const kind of backendKinds) {
		const rule = registry[kind].credential;
		const token = credentials[kind];
		if (token === null || !rule.checked(configuration)) {
			continue;
		}
		const verdict = await rule.check(token, fetchImpl);
		if (verdict === "rejected") {
			return rule.rejected;
		}
		if (verdict !== "accepted") {
			warn(verdict.warning);
			return null;
		}
	}
	return null;
}

export type ProjectReader = { tracker: Tracker } | { error: string };

export type Backends = {
	trackers: ReadonlyMap<TrackerKind, Tracker>;
	/** The forge of each host that a PR reference can name. */
	forges: ReadonlyMap<string, Forge>;
	/** Each tracker and forge kind with its label and whether it has a token. */
	views: BackendViews;
	/** The tracker that reads the project of `ref`, or the error to show on it. */
	readerOf: (ref: ProjectRef, hosts: Configuration["hosts"]) => ProjectReader;
	/** The name of the forge on the host of `url`, or undefined when no forge serves that host. */
	forgeLabelOf: (
		url: string,
		hosts: Configuration["hosts"],
	) => string | undefined;
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
		const token = credentials[kind];
		return token === null
			? null
			: { host: registry[kind].homeHost, token, fetch, repoFetch };
	};
	const view = <Kind extends BackendKind>(kind: Kind): BackendView<Kind> => ({
		kind,
		label: registry[kind].label,
		hint: registry[kind].hint,
		credential: credentials[kind] === null ? "missing" : "present",
	});
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
		if (forge !== null) {
			forges.set(registry[kind].homeHost, forge);
		}
	}
	const explained = new Set<string>();
	const unreadable = (error: string): ProjectReader => {
		explained.add(error);
		return { error };
	};
	const hostedReader = (
		kind: TrackerKind,
		host: string,
		hosts: Configuration["hosts"],
	): ProjectReader => {
		const declared = hosts.find((entry) => entry.host === host);
		if (declared === undefined) {
			return unreadable(`${host} is not declared in hosts.`);
		}
		const token = usable(env[declared.tokenEnv]);
		if (token === null) {
			return unreadable(
				`${declared.tokenEnv} is missing: set ${declared.tokenEnv} to read ${host}.`,
			);
		}
		const context = { host, token, fetch, repoFetch };
		const forge = registry[declared.forge].forge(context);
		const tracker = forge === null ? null : registry[kind].tracker(context);
		if (forge === null || tracker === null) {
			return unreadable(`the ${declared.forge} forge cannot read ${host} yet.`);
		}
		forges.set(host, forge);
		return { tracker };
	};
	return {
		trackers,
		forges,
		views: {
			trackers: trackerKinds.map((kind) => view(kind)),
			forges: forgeKinds.map((kind) => view(kind)),
		},
		readerOf(ref, hosts) {
			const host = refHost(ref);
			if (host !== undefined) {
				return hostedReader(ref.tracker, host, hosts);
			}
			const tracker = trackers.get(ref.tracker);
			return tracker === undefined
				? unreadable(registry[ref.tracker].credential.missing)
				: { tracker };
		},
		forgeLabelOf(url, hosts) {
			const host = URL.parse(url)?.host;
			const kind =
				forgeKinds.find((forge) => registry[forge].homeHost === host) ??
				hosts.find((declared) => declared.host === host)?.forge;
			return kind === undefined ? undefined : registry[kind].label;
		},
		forgeOf: (ref) =>
			forges.get(refHost(ref) ?? registry[ref.tracker].homeHost) ?? null,
		declaredHostOf(forge) {
			const home = new Set(backendKinds.map((kind) => registry[kind].homeHost));
			for (const [host, held] of forges) {
				if (held === forge && !home.has(host)) {
					return host;
				}
			}
			return undefined;
		},
		explains: (error) => explained.has(error),
	};
}
