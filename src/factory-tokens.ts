import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { Fetch } from "./fetch.ts";

const hostsFile = z.object({
	"github.com": z.object({
		oauth_token: z.string().trim().min(1),
		expires_at: z.string(),
	}),
});

/** The exit status of the mint command, or "missing" when it cannot start. */
export type MintStatus = number | "missing";

/** The exit status of one mint run and what the command wrote to stderr. */
export type MintResult = { status: MintStatus; stderr: string };

/** Runs the factory mint command, which writes one hosts file per owner. */
export type FactoryTokenMint = (
	command: string[],
	dir: string,
) => Promise<MintResult>;

export type FactoryTokenFileReport = {
	owner: string;
	cause: "missing" | "unreadable" | "expired";
	path: string;
};

export type FactoryTokenReport =
	| FactoryTokenFileReport
	| {
			cause: "mint failed";
			command: string;
			status: MintStatus;
			detail?: string;
	  };

const tokenRenewWithinMs = 5 * 60 * 1000;

const mintTries = 3;

const defaultMintRetryDelayMs = 10_000;

function lastStderrLine(stderr: string): string | undefined {
	return stderr
		.split("\n")
		.map((line) => line.trim())
		.findLast((line) => line !== "");
}

const repoInUrl =
	/^https:\/\/api\.github\.com\/repos\/([^/]+)\/[^/]+(?:\/|$|\?)/;

function repoOwner(url: string, body: string): string | null {
	const fromUrl = repoInUrl.exec(url)?.[1];
	if (fromUrl !== undefined) {
		return fromUrl;
	}
	if (url !== "https://api.github.com/graphql" || body === "") {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed === null || typeof parsed !== "object") {
			return null;
		}
		const variables = "variables" in parsed ? parsed.variables : null;
		if (variables === null || typeof variables !== "object") {
			return null;
		}
		const owner = "owner" in variables ? variables.owner : null;
		if (typeof owner === "string" && owner !== "") {
			return owner;
		}
		const projectOwner =
			"projectOwner" in variables ? variables.projectOwner : null;
		if (typeof projectOwner === "string" && projectOwner !== "") {
			return projectOwner;
		}
		const login = "login" in variables ? variables.login : null;
		return typeof login === "string" && login !== "" ? login : null;
	} catch {
		return null;
	}
}

function hostsToken(
	text: string,
	now: Date,
): { token: string; expiresAt: number } | "unreadable" | "expired" {
	let yaml: unknown;
	try {
		yaml = Bun.YAML.parse(text);
	} catch {
		return "unreadable";
	}
	const hosts = hostsFile.safeParse(yaml);
	if (!hosts.success) {
		return "unreadable";
	}
	const { oauth_token: token, expires_at: expires } = hosts.data["github.com"];
	const expiresAt = Date.parse(expires);
	if (Number.isNaN(expiresAt)) {
		return "unreadable";
	}
	if (expiresAt <= now.getTime()) {
		return "expired";
	}
	return { token, expiresAt };
}

function graphqlMutation(url: string, body: string): boolean {
	if (url !== "https://api.github.com/graphql" || body === "") {
		return false;
	}
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed === null || typeof parsed !== "object" || !("query" in parsed)) {
			return false;
		}
		const query = parsed.query;
		return typeof query === "string" && /^\s*mutation\b/.test(query);
	} catch {
		return false;
	}
}

async function hostsAt(
	path: string,
	now: Date,
): Promise<ReturnType<typeof hostsToken> | "missing"> {
	try {
		return hostsToken(await readFile(path, "utf8"), now);
	} catch (error) {
		const missing =
			error instanceof Error && "code" in error && error.code === "ENOENT";
		return missing ? "missing" : "unreadable";
	}
}

/**
 * Sends each GitHub read with the factory token of its repo owner. A read
 * without a usable token waits for a mint, then goes on with the user token,
 * and `reports` names each owner whose hosts file is missing, unreadable or
 * expired, and a mint that failed.
 *
 * `mint` runs at most one at a time. A failed run runs again after
 * `retryDelayMs`, up to three runs in all, before `reports` names it. A read
 * or a held token near its expiry starts a mint at most once per renew
 * window; `mintNow` starts one at once.
 */
export function installationTokenFetch(
	fetchImpl: Fetch,
	read: () => {
		enabled: boolean;
		dir: string;
		mintCommand: string[];
	},
	now: () => Date,
	mint?: FactoryTokenMint,
	retryDelayMs: number = defaultMintRetryDelayMs,
): {
	fetch: Fetch;
	reports: () => FactoryTokenReport[];
	mintNow: () => Promise<void>;
	stop: () => void;
} {
	const cached = new Map<
		string,
		{ token: string; expiresAt: number; dir: string }
	>();
	const reported = new Map<string, FactoryTokenFileReport>();
	let mintFailure: FactoryTokenReport | null = null;
	let minting: Promise<void> | null = null;
	let lastMintAt = Number.NEGATIVE_INFINITY;
	let renewAt: number | null = null;
	let renewTimer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const mintWithRetries = async (
		run: FactoryTokenMint,
		command: string[],
		dir: string,
	): Promise<MintResult> => {
		for (let tries = 1; ; tries += 1) {
			const result = await run(command, dir).catch((): MintResult => ({
				status: "missing",
				stderr: "",
			}));
			if (
				result.status === 0 ||
				result.status === "missing" ||
				tries === mintTries ||
				stopped
			) {
				return result;
			}
			await Bun.sleep(retryDelayMs);
		}
	};
	const mintNow = (): Promise<void> => {
		const settings = read();
		if (mint === undefined || !settings.enabled) {
			return Promise.resolve();
		}
		lastMintAt = now().getTime();
		const command = settings.mintCommand.join(" ");
		minting ??= mintWithRetries(mint, settings.mintCommand, settings.dir)
			.then(({ status, stderr }) => {
				const detail = lastStderrLine(stderr);
				mintFailure =
					status === 0
						? null
						: {
								cause: "mint failed",
								command,
								status,
								...(detail === undefined ? {} : { detail }),
							};
			})
			.finally(() => {
				minting = null;
			});
		return minting;
	};
	const mintOnce = (): Promise<void> | null => {
		if (minting !== null) {
			return minting;
		}
		if (
			mint === undefined ||
			now().getTime() - lastMintAt < tokenRenewWithinMs
		) {
			return null;
		}
		return mintNow();
	};
	const renewBefore = (expiresAt: number) => {
		const at = expiresAt - tokenRenewWithinMs;
		if (mint === undefined || (renewAt !== null && renewAt <= at)) {
			return;
		}
		clearTimeout(renewTimer);
		renewAt = at;
		renewTimer = setTimeout(
			() => {
				renewAt = null;
				void mintOnce();
			},
			Math.max(0, at - now().getTime()),
		);
	};
	const reports = (): FactoryTokenReport[] => {
		const settings = read();
		if (!settings.enabled) {
			return [];
		}
		const files = [...reported.values()].filter(
			(entry) => entry.path === join(settings.dir, entry.owner, "hosts.yml"),
		);
		return mintFailure === null ? files : [mintFailure, ...files];
	};
	const fetch: Fetch = async (input, init) => {
		const withToken = (token: string) => {
			const headers = new Headers(init?.headers);
			headers.set("authorization", `Bearer ${token}`);
			return fetchImpl(input, { ...init, headers });
		};
		const settings = read();
		if (!settings.enabled) {
			return fetchImpl(input, init);
		}
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const method = (init?.method ?? "GET").toUpperCase();
		const body = typeof init?.body === "string" ? init.body : "";
		const owner = repoOwner(url, body);
		const write =
			(method !== "GET" &&
				method !== "HEAD" &&
				!url.startsWith("https://api.github.com/graphql")) ||
			graphqlMutation(url, body);
		if (owner === null || write) {
			return fetchImpl(input, init);
		}
		const current = now();
		const held = cached.get(owner);
		if (
			held !== undefined &&
			held.dir === settings.dir &&
			held.expiresAt - current.getTime() > tokenRenewWithinMs
		) {
			return withToken(held.token);
		}
		cached.delete(owner);
		const path = join(settings.dir, owner, "hosts.yml");
		const fallBack = (cause: FactoryTokenFileReport["cause"]) => {
			reported.set(owner, { owner, cause, path });
			return fetchImpl(input, init);
		};
		let parsed = await hostsAt(path, current);
		const pending = typeof parsed === "string" ? mintOnce() : null;
		if (pending !== null) {
			await pending;
			parsed = await hostsAt(path, now());
		}
		if (typeof parsed === "string") {
			return fallBack(parsed);
		}
		reported.delete(owner);
		cached.set(owner, { ...parsed, dir: settings.dir });
		renewBefore(parsed.expiresAt);
		return withToken(parsed.token);
	};
	const stop = () => {
		stopped = true;
		clearTimeout(renewTimer);
	};
	return { fetch, reports, mintNow, stop };
}
