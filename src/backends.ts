import type { Configuration } from "./configuration.ts";
import {
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

const credentialRules: Record<BackendKind, CredentialRule> = {
	github: {
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
	linear: {
		env: "LINEAR_API_KEY",
		missing: missingLinearKey,
		rejected: rejectedLinearKey,
		checked: ({ tracked }) => tracked.some((pin) => pin.tracker === "linear"),
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
};

function usable(token: string | null | undefined): string | null {
	const trimmed = token?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

/** Reads the token of each backend kind from its env var, or else from its fallback. */
export async function readCredentials(io: TokenIo): Promise<Credentials> {
	const read = async (kind: BackendKind) => {
		const rule = credentialRules[kind];
		return usable(io.env[rule.env]) ?? usable(await rule.fallback?.(io));
	};
	return { github: await read("github"), linear: await read("linear") };
}

/** Checks each token that the configuration needs. Answers the message that stops the start, or null. */
export async function rejectedCredential(
	credentials: Credentials,
	configuration: Configuration,
	fetchImpl: Fetch,
	warn: (message: string) => void,
): Promise<string | null> {
	for (const kind of backendKinds) {
		const rule = credentialRules[kind];
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

type AdapterContext = {
	host: string;
	token: string;
	fetch: Fetch;
	/** The fetch of the repo reads, which the factory tokens and the validators cover. */
	repoFetch: Fetch;
};

type Factory<Adapter> = (context: AdapterContext) => Adapter | null;

/** The factories of one app start. A factory answers null for a host that its adapter cannot read. */
function adapterFactories(): {
	trackers: Record<TrackerKind, Factory<Tracker>>;
	forges: Record<ForgeKind, Factory<Forge>>;
} {
	let github: ReturnType<typeof githubAdapters> | undefined;
	const githubOf = ({ host, token, repoFetch }: AdapterContext) => {
		if (host !== githubHost) {
			return null;
		}
		github ??= githubAdapters(token, repoFetch);
		return github;
	};
	return {
		trackers: {
			github: (context) => githubOf(context)?.tracker ?? null,
			linear: ({ token, fetch }) => linearTracker(token, fetch),
		},
		forges: {
			github: (context) => githubOf(context)?.forge ?? null,
		},
	};
}

/** The host of a project whose pin names no host. */
const homeHosts: Record<BackendKind, string> = {
	github: githubHost,
	linear: "linear.app",
};

export type ProjectReader = { tracker: Tracker } | { error: string };

export type Backends = {
	trackers: ReadonlyMap<TrackerKind, Tracker>;
	/** The forge of each host that a PR reference can name. */
	forges: ReadonlyMap<string, Forge>;
	/** Whether each tracker kind has a token. */
	configured: Record<TrackerKind, boolean>;
	/** The tracker that reads the project of `ref`, or the error to show on it. */
	readerOf: (ref: ProjectRef, hosts: Configuration["hosts"]) => ProjectReader;
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
	const factories = adapterFactories();
	const homeContext = (kind: BackendKind): AdapterContext | null => {
		const token = credentials[kind];
		return token === null
			? null
			: { host: homeHosts[kind], token, fetch, repoFetch };
	};
	const trackers = new Map<TrackerKind, Tracker>();
	for (const kind of trackerKinds) {
		const context = homeContext(kind);
		const tracker = context === null ? null : factories.trackers[kind](context);
		if (tracker !== null) {
			trackers.set(kind, tracker);
		}
	}
	const forges = new Map<string, Forge>();
	for (const kind of forgeKinds) {
		const context = homeContext(kind);
		const forge = context === null ? null : factories.forges[kind](context);
		if (forge !== null) {
			forges.set(homeHosts[kind], forge);
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
		const forge = factories.forges[declared.forge](context);
		const tracker = forge === null ? null : factories.trackers[kind](context);
		if (forge === null || tracker === null) {
			return unreadable(`the ${declared.forge} forge cannot read ${host} yet.`);
		}
		forges.set(host, forge);
		return { tracker };
	};
	return {
		trackers,
		forges,
		configured: {
			github: credentials.github !== null,
			linear: credentials.linear !== null,
		},
		readerOf(ref, hosts) {
			const host = refHost(ref);
			if (host !== undefined) {
				return hostedReader(ref.tracker, host, hosts);
			}
			const tracker = trackers.get(ref.tracker);
			return tracker === undefined
				? unreadable(credentialRules[ref.tracker].missing)
				: { tracker };
		},
		forgeOf: (ref) =>
			forges.get(refHost(ref) ?? homeHosts[ref.tracker]) ?? null,
		declaredHostOf(forge) {
			const home = new Set<string>(Object.values(homeHosts));
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
