import { describe, expect, test } from "bun:test";

import { withApp } from "../project-harness.ts";
import { githubEnv, mergeFake, pullUrl, widgetConfig } from "./_support.ts";

describe("merge requests from another site", () => {
	const crossSite = [
		{
			name: "a form post from another site",
			headers: {
				"content-type": "text/plain",
				origin: "https://attacker.example",
			},
			status: 403,
		},
		{
			name: "a JSON post from another site",
			headers: {
				"content-type": "application/json",
				origin: "https://attacker.example",
			},
			status: 403,
		},
		{
			name: "a text post with no origin",
			headers: { "content-type": "text/plain" },
			status: 415,
		},
	];

	for (const { name, headers, status } of crossSite) {
		test(`${name} is refused, and GitHub gets no request`, async () => {
			const fake = mergeFake();
			await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
				const sent = await fetch(new URL("/api/pulls/merge", base), {
					method: "POST",
					headers,
					body: JSON.stringify({ url: pullUrl }),
				});
				expect(sent.status).toBe(status);
				expect(fake.merges).toEqual([]);
			});
		});
	}

	const sendAs = (base: string, host: string) =>
		fetch(new URL("/api/pulls/merge", base), {
			method: "POST",
			headers: {
				"content-type": "application/json",
				host: `${host}:${new URL(base).port}`,
				origin: `http://${host}:${new URL(base).port}`,
			},
			body: JSON.stringify({ url: pullUrl }),
		});

	test("a merge whose host and origin both name a rebound domain is refused, and GitHub gets no request", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const sent = await sendAs(base, "attacker.example");
			expect(sent.status).toBe(403);
			expect(fake.merges).toEqual([]);
		});
	});

	test("a merge through the localhost name of the server is accepted", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const sent = await sendAs(base, "localhost");
			expect(sent.status).toBe(204);
			expect(fake.merges).toHaveLength(1);
		});
	});

	test("a merge from the page origin is accepted", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const sent = await fetch(new URL("/api/pulls/merge", base), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: new URL(base).origin,
				},
				body: JSON.stringify({ url: pullUrl }),
			});
			expect(sent.status).toBe(204);
			expect(fake.merges).toHaveLength(1);
		});
	});
});
