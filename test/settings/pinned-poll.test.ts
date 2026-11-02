import { describe, expect, test } from "bun:test";

import type { ProjectPin } from "../../src/configuration.ts";
import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { urlOf } from "../support/fetch.ts";
import { openEventStream } from "../support/reads.ts";
import { quiet, recorded, savedRepo, shown, withApp } from "./_support.ts";

type Gate = { wait: Promise<void>; open: () => void };

function gate(): Gate {
	let open: () => void = () => {};
	const wait = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { wait, open };
}

function repoOfRead(input: string | URL | Request, init?: RequestInit) {
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		urlOf(input) !== "https://api.github.com/graphql" ||
		!body.includes("query RepoRead")
	) {
		return null;
	}
	const { variables } = JSON.parse(body) as {
		variables?: { owner?: string; name?: string };
	};
	return `${variables?.owner}/${variables?.name}`;
}

describe("pinned projects during a poll", () => {
	test("each overview of the first poll lists the pinned projects first, pending or read", async () => {
		const tracked: ProjectPin[] = [
			{ tracker: "github", repo: shown },
			{ tracker: "github", repo: quiet },
			{ tracker: "github", repo: savedRepo },
		];
		const pinnedProjects: ProjectPin[] = [
			{ tracker: "github", repo: shown },
			{ tracker: "github", repo: quiet },
		];
		const gates = new Map<string, Gate>(
			[savedRepo, shown, quiet].map((repo) => [repo, gate()]),
		);
		const held =
			(requests: string[]): Fetch =>
			async (input, init) => {
				const repo = repoOfRead(input, init);
				await (repo === null ? undefined : gates.get(repo)?.wait);
				return recorded(requests, input, init);
			};
		const shots: { name: string; pinned: boolean; pending: boolean }[][] = [];
		try {
			await withApp(
				JSON.stringify({ tracked, pinnedProjects }),
				async (base) => {
					const stream = openEventStream(base);
					await stream.ready;
					const toRelease = [...gates.values()];
					toRelease.shift()?.open();
					try {
						for await (const { event, data } of stream.events) {
							if (event !== "overview" && event !== "views") {
								continue;
							}
							const body = JSON.parse(data) as Overview;
							shots.push(
								body.projects.map((project) => ({
									name: project.name,
									pinned: project.pinned === true,
									pending: project.pending === true,
								})),
							);
							if (body.polling !== true) {
								break;
							}
							toRelease.shift()?.open();
						}
					} finally {
						stream.close();
					}
				},
				undefined,
				held,
				{ first: true },
			);
		} finally {
			for (const item of gates.values()) {
				item.open();
			}
		}

		const listed = shots.filter((shot) => shot.length > 0);
		expect(listed.length).toBeGreaterThan(2);
		expect(
			listed.some((shot) =>
				shot.some((project) => project.pinned && project.pending),
			),
		).toBe(true);
		expect(
			listed.some((shot) =>
				shot.some((project) => project.pinned && !project.pending),
			),
		).toBe(true);
		for (const shot of listed) {
			expect(shot.map((project) => [project.name, project.pinned])).toEqual([
				[quiet, true],
				[shown, true],
				[savedRepo, false],
			]);
		}
	});
});
