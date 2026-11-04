import { expect } from "bun:test";

import type { InsightAnswer, InsightTables } from "../../src/run-history.ts";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	serve,
} from "../support/factory.ts";

/** The app with one hub that answers `answers`, on the store at `databasePath` when given. */
export async function serveHub(
	answers: Answers = hub,
	databasePath?: string,
): ReturnType<typeof serve> {
	const requests: FactoryRequest[] = [];
	return serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch({ [hubUrl]: answers }, requests),
		{
			env: { GITHUB_TOKEN: "recorded-token" },
			...(databasePath === undefined ? {} : { databasePath }),
		},
	);
}

export async function insightQuery(
	base: string,
	sql: string,
): Promise<{ status: number; body: InsightAnswer | { error: string } }> {
	const response = await fetch(new URL("/api/insights/query", base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sql }),
	});
	return {
		status: response.status,
		body: (await response.json()) as InsightAnswer | { error: string },
	};
}

/** The answer to `sql`, once its row count meets `accept`. */
export async function answerWhere(
	base: string,
	sql: string,
	accept: (rowCount: number) => boolean,
): Promise<InsightAnswer> {
	while (true) {
		const { status, body } = await insightQuery(base, sql);
		expect(status).toBe(200);
		if ("rows" in body && accept(body.rowCount)) {
			return body;
		}
		await Bun.sleep(20);
	}
}

export async function insightTables(base: string): Promise<InsightTables> {
	const response = await fetch(new URL("/api/insights", base));
	expect(response.status).toBe(200);
	return (await response.json()) as InsightTables;
}
