import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "./fetch.ts";

const tokenRenewWithinMs = 5 * 60 * 1000;

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
		return typeof projectOwner === "string" && projectOwner !== ""
			? projectOwner
			: null;
	} catch {
		return null;
	}
}

function hostsToken(
	text: string,
	now: Date,
): { token: string; expiresAt: number } | null {
	const token = text.match(/^\s*oauth_token:\s*(\S+)\s*$/m)?.[1];
	const expires = text.match(/^\s*expires_at:\s*(\S+)\s*$/m)?.[1];
	if (token === undefined || expires === undefined) {
		return null;
	}
	const expiresAt = Date.parse(expires);
	if (
		Number.isNaN(expiresAt) ||
		expiresAt - now.getTime() <= tokenRenewWithinMs
	) {
		return null;
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

export function installationTokenFetch(
	fetchImpl: Fetch,
	read: () => {
		enabled: boolean;
		dir: string;
	},
	now: () => Date,
): Fetch {
	const cached = new Map<string, { token: string; expiresAt: number }>();
	return async (input, init) => {
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
			held.expiresAt - current.getTime() > tokenRenewWithinMs
		) {
			return withToken(held.token);
		}
		cached.delete(owner);
		let text: string;
		try {
			text = await readFile(join(settings.dir, owner, "hosts.yml"), "utf8");
		} catch {
			return fetchImpl(input, init);
		}
		const parsed = hostsToken(text, current);
		if (parsed === null) {
			return fetchImpl(input, init);
		}
		cached.set(owner, parsed);
		return withToken(parsed.token);
	};
}
