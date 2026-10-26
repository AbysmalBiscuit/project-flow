import type { z } from "zod";

import type { Fetch } from "./fetch.ts";

export const factoryRequestLimitMs = 5_000;

export class Unreachable extends Error {}

/** The factory answered a read with 404: it does not serve the route. */
export class NotServed extends Unreachable {}

export type Read = (path: string) => Promise<Response>;

/** A stream request has no time limit: it stays open while the hub sends events. */
export function reader(
	fetchImpl: Fetch,
	url: string,
	signal: AbortSignal,
	limitMs: number | null = factoryRequestLimitMs,
) {
	const parsed = new URL(url);
	const unix = parsed.protocol === "unix:";
	const base = unix
		? "http://localhost"
		: `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
	return async (path: string, post?: { json: unknown }): Promise<Response> => {
		try {
			return await fetchImpl(`${base}${path}`, {
				signal:
					limitMs === null
						? signal
						: AbortSignal.any([signal, AbortSignal.timeout(limitMs)]),
				...(unix ? { unix: parsed.pathname } : {}),
				...(post === undefined
					? {}
					: {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(post.json),
						}),
			});
		} catch {
			throw new Unreachable();
		}
	};
}

export async function body<T>(
	response: Response,
	schema: z.ZodType<T>,
): Promise<T> {
	if (response.status === 404) {
		throw new NotServed();
	}
	if (!response.ok) {
		throw new Unreachable();
	}
	const parsed = schema.safeParse(await response.json().catch(() => null));
	if (!parsed.success) {
		throw new Unreachable();
	}
	return parsed.data;
}
