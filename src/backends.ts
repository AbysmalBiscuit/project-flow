import {
	type AdapterContext,
	backendHints,
	type BackendKind,
	backendKinds,
	backendRegistry,
	byKind,
	type Credentials,
	type Env,
	type RepoFetch,
	type RepoFetchContext,
	type TokenCheck,
	type TokenIo,
	usable,
} from "./backend-registry.ts";
import type { Configuration } from "./configuration.ts";
import {
	type BackendView,
	type BackendViews,
	forgeKinds,
	type TrackerKind,
	trackerKinds,
} from "./domain.ts";
export type { FactoryTokenMint } from "./factory-tokens.ts";
import type { Fetch } from "./fetch.ts";
import { missingHostToken, rejectedHostToken } from "./host-tokens.ts";
import type { Forge, PullTarget, Tracker } from "./ports.ts";
import { type ProjectRef, refHost } from "./project-ref.ts";
import { takesClaimedStart } from "./run-start.ts";

export type {
	Credentials,
	Env,
	RepoFetch,
	RepoFetchContext,
	TokenIo,
} from "./backend-registry.ts";

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
				rejected: rejectedHostToken(tokenEnv, host),
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
	/** The tracker of each declared host that its forge kind also tracks and whose token is set. */
	hostedTrackers: (hosts: Hosts) => Tracker[];
	/** The tracker that reads the project of `ref`, or the error to show on it. */
	readerOf: (ref: ProjectRef, hosts: Hosts) => ProjectReader;
	/**
	 * The forge and the PR that a URL names, or null for a URL that names no PR
	 * of a readable forge. A PR on a host whose token is missing answers its error.
	 */
	linkOf: (
		url: URL,
		hosts: Hosts,
	) => { forge: Forge; target: PullTarget } | { error: string } | null;
	/** The name of the forge on the host of `url`, or undefined when no forge serves that host. */
	forgeLabelOf: (url: string, hosts: Hosts) => string | undefined;
	/** The forge that holds the repo of the project of `ref`. */
	forgeOf: (ref: ProjectRef) => Forge | null;
	/** The host that the repo keys of a forge carry, or undefined for bare keys. */
	keyHostOf: (forge: Forge) => string | undefined;
	/** True for an error that `readerOf` or `linkOf` gave: the project waits for a setting and no read failed. */
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
			: {
					host: home.host,
					token,
					tokenEnv: home.credential.env,
					fetch,
					repoFetch,
				};
	};
	const homeHosts = new Set(
		backendKinds.flatMap((kind) => registry[kind].home?.host ?? []),
	);
	const bareKeyHosts = new Set(
		backendKinds.flatMap((kind) => {
			const home = registry[kind].home;
			return home?.bareKeys === true ? [home.host] : [];
		}),
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
	const listsBackend = (kind: BackendKind, hosts: Hosts): boolean =>
		registry[kind].home !== undefined ||
		hosts.some((entry) => entry.forge === kind);
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
	):
		| { forge: Forge; context: AdapterContext }
		| { error: string; credential: boolean } => {
		const declared = hosts.find((entry) => entry.host === host);
		if (declared === undefined) {
			return { error: `${host} is not declared in hosts.`, credential: false };
		}
		const token = usable(env[declared.tokenEnv]);
		if (token === null) {
			return {
				error: missingHostToken(declared.tokenEnv, host),
				credential: true,
			};
		}
		const context = {
			host,
			token,
			tokenEnv: declared.tokenEnv,
			fetch,
			repoFetch,
		};
		const id = JSON.stringify([host, declared.forge, token]);
		if (!declaredForges.has(id)) {
			declaredForges.set(id, registry[declared.forge].forge(context));
		}
		const forge = declaredForges.get(id) ?? null;
		if (forge === null) {
			return {
				error: `the ${declared.forge} forge cannot read ${host} yet.`,
				credential: false,
			};
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
		const declared = hosts.find((entry) => entry.host === host);
		const tracker =
			declared?.forge === kind ? registry[kind].tracker(hosted.context) : null;
		return tracker === null
			? unreadable(`the ${kind} tracker cannot read ${host} yet.`)
			: { tracker };
	};
	return {
		trackers,
		forges,
		hostedTrackers: (hosts) =>
			hosts.flatMap(({ host, forge }) => {
				const kind = trackerKinds.find((known) => known === forge);
				const reader =
					kind === undefined ? null : hostedReader(kind, host, hosts);
				return reader !== null && "tracker" in reader ? [reader.tracker] : [];
			}),
		views: (hosts) => ({
			trackers: trackerKinds
				.filter((kind) => listsBackend(kind, hosts))
				.map((kind) => ({
					...view(kind, hosts),
					claimsRuns: takesClaimedStart(kind),
				})),
			forges: forgeKinds
				.filter((kind) => listsBackend(kind, hosts))
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
				? unreadable(
						registry[ref.tracker].home?.credential.missing ??
							`the ${ref.tracker} tracker reads only a declared host.`,
					)
				: { tracker };
		},
		linkOf(url, hosts) {
			const read = (forge: Forge) => {
				const target = forge.pullOfUrl(url);
				return target === null ? null : { forge, target };
			};
			const homeForge = forges.get(url.host);
			if (homeHosts.has(url.host)) {
				if (homeForge !== undefined) {
					return read(homeForge);
				}
				const home = backendKinds
					.map((kind) => registry[kind].home)
					.find((item) => item?.host === url.host);
				if (home?.pullOfUrl === undefined || home.pullOfUrl(url) === null) {
					return null;
				}
				explained.add(home.credential.missing);
				return { error: home.credential.missing };
			}
			if (!hosts.some((declared) => declared.host === url.host)) {
				return null;
			}
			const hosted = hostedForge(url.host, hosts);
			if (!("error" in hosted)) {
				return read(hosted.forge);
			}
			if (!hosted.credential) {
				return null;
			}
			explained.add(hosted.error);
			return { error: hosted.error };
		},
		forgeLabelOf(url, hosts) {
			const host = URL.parse(url)?.host;
			const kind =
				forgeKinds.find((forge) => registry[forge].home?.host === host) ??
				hosts.find((declared) => declared.host === host)?.forge;
			return kind === undefined ? undefined : registry[kind].label;
		},
		forgeOf(ref) {
			const host = refHost(ref) ?? registry[ref.tracker].home?.host;
			return host === undefined ? null : (forges.get(host) ?? null);
		},
		keyHostOf(forge) {
			for (const [host, held] of forges) {
				if (held === forge) {
					return bareKeyHosts.has(host) ? undefined : host;
				}
			}
			return undefined;
		},
		explains: (error) => explained.has(error),
	};
}
