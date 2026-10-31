import { describe, expect, test } from "bun:test";

import { withApp } from "../project-harness.ts";
import {
	githubEnv,
	mergeFake,
	pullUrl,
	repo,
	widgetConfig,
} from "./_support.ts";

describe("writes from another site", () => {
	const attacker = { origin: "https://attacker.example" };

	test("the reply route refuses a form post from another site, and GitHub gets no request", async () => {
		const sentToGitHub: string[] = [];
		const fake = mergeFake();
		await withApp(
			widgetConfig,
			(input, init) => {
				if (init?.method === "POST" && !String(input).endsWith("graphql")) {
					sentToGitHub.push(String(input));
				}
				return fake.fetch(input, init);
			},
			githubEnv,
			async (base) => {
				const sent = await fetch(new URL("/api/replies", base), {
					method: "POST",
					headers: { ...attacker, "content-type": "text/plain" },
					body: JSON.stringify({
						project: repo,
						key: "acme/widget#8",
						body: "x",
					}),
				});
				expect(sent.status).toBe(403);
				expect(sentToGitHub).toEqual([]);
			},
		);
	});

	test("a route with no body refuses another site and accepts the page", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const refresh = new URL("/api/refresh", base);
			const refused = await fetch(refresh, {
				method: "POST",
				headers: attacker,
			});
			expect(refused.status).toBe(403);
			const accepted = await fetch(refresh, {
				method: "POST",
				headers: { origin: new URL(base).origin },
			});
			expect(accepted.status).toBe(204);
		});
	});

	test("the settings route refuses a write from another site", async () => {
		const fake = mergeFake();
		await withApp(widgetConfig, fake.fetch, githubEnv, async (base) => {
			const sent = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { ...attacker, "content-type": "application/json" },
				body: "{}",
			});
			expect(sent.status).toBe(403);
		});
	});
});

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

	describe("on a wildcard bind", () => {
		const sendOnWildcard = (
			base: string,
			authority: string,
			origin: string,
		) => {
			const local = new URL("/api/pulls/merge", base);
			local.hostname = "127.0.0.1";
			return fetch(local, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					host: authority,
					origin,
				},
				body: JSON.stringify({ url: pullUrl }),
			});
		};

		for (const host of ["0.0.0.0", "::"]) {
			test(`${host} accepts an origin that matches the request host`, async () => {
				const fake = mergeFake();
				await withApp(
					widgetConfig,
					fake.fetch,
					githubEnv,
					async (base) => {
						const sent = await sendOnWildcard(
							base,
							"desk.example:3000",
							"http://desk.example:3000",
						);
						expect(sent.status).toBe(204);
						expect(fake.merges).toHaveLength(1);
					},
					undefined,
					host,
				);
			});

			test(`${host} refuses an origin that does not match the request host`, async () => {
				const fake = mergeFake();
				await withApp(
					widgetConfig,
					fake.fetch,
					githubEnv,
					async (base) => {
						const sent = await sendOnWildcard(
							base,
							"desk.example:3000",
							"https://attacker.example",
						);
						expect(sent.status).toBe(403);
						expect(fake.merges).toEqual([]);
					},
					undefined,
					host,
				);
			});
		}
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
